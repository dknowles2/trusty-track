/**
 * The browser half of the serial proxy (issue #89).
 *
 * The backend probes by asking for the port to be opened with one device's
 * framing, writing that device's probe command, and watching what comes back —
 * then doing it again for the next candidate. Reopening is the part that lives
 * here, and it is the part with a trap in it: a serial port cannot be closed
 * while a reader holds its lock, and the read loop ending has to be told apart
 * from the device being unplugged.
 *
 * Web Serial does not exist in jsdom, so the port and the socket below are
 * fakes. They are small because the surface is: open, close, read, write.
 */

import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SerialProxyProvider, useSerialProxy } from './SerialProxyContext';

type Options = { baudRate: number; dataBits?: number; stopBits?: number; parity?: string };

class FakeReader {
    private queue: Uint8Array[] = [];
    private waiting: ((r: { value: Uint8Array; done: boolean }) => void) | null = null;
    private done = false;
    released = false;

    read(): Promise<{ value: Uint8Array; done: boolean }> {
        if (this.done) return Promise.resolve({ value: new Uint8Array(), done: true });
        const next = this.queue.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        return new Promise((resolve) => { this.waiting = resolve; });
    }

    push(bytes: Uint8Array) {
        const waiting = this.waiting;
        this.waiting = null;
        if (waiting) waiting({ value: bytes, done: false });
        else this.queue.push(bytes);
    }

    cancel(): Promise<void> {
        this.done = true;
        const waiting = this.waiting;
        this.waiting = null;
        if (waiting) waiting({ value: new Uint8Array(), done: true });
        return Promise.resolve();
    }

    releaseLock() { this.released = true; }
}

class FakePort {
    opened: Options[] = [];
    closes = 0;
    written: Uint8Array[] = [];
    reader = new FakeReader();
    private readerObtained = false;
    private isOpen = false;

    readable = {
        getReader: () => {
            this.reader = new FakeReader();
            this.readerObtained = true;
            return this.reader;
        },
    };
    writable = {
        getWriter: () => ({
            write: async (data: Uint8Array) => { this.written.push(data); },
            releaseLock: () => {},
        }),
    };

    // A real SerialPort's open() rejects with InvalidStateError on a port
    // that is already open (#331: exactly what a stranded port produces on
    // the next connect()) — mirrored here so a test fails on that symptom
    // instead of only on the internal bookkeeping.
    async open(options: Options) {
        if (this.isOpen) {
            throw new Error('Failed to execute \'open\': The port is already open.');
        }
        this.opened.push(options);
        this.isOpen = true;
    }

    // A real SerialPort's close() rejects while a reader holds the lock — the
    // other #331 trap. Mirroring that here is what lets a test fail without
    // the fix instead of merely passing by accident.
    async close() {
        if (this.readerObtained && !this.reader.released) {
            throw new Error('Failed to execute \'close\': The port is locked by a reader.');
        }
        this.closes += 1;
        this.isOpen = false;
    }
}

class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static last: FakeSocket | null = null;

    readyState = FakeSocket.OPEN;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number; reason: string }) => void | Promise<void>) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) { FakeSocket.last = this; }

    send(data: string) { this.sent.push(data); }

    /** This tab closing its own connection — no reason, as a real browser
     * gives none for a locally-initiated close. Returns a promise so a test
     * can wait for onclose's (now async) teardown to actually finish. */
    async close() { this.readyState = 3; await this.onclose?.({ code: 1000, reason: '' }); }

    /** The backend closing this connection and saying why — the role check,
     * a track problem, or a second connection taking the timer over (#301). */
    async remoteClose(code: number, reason: string) {
        this.readyState = 3;
        await this.onclose?.({ code, reason });
    }

    /** Deliver a message from the backend, and let its handler settle. */
    async deliver(message: object) {
        await act(async () => {
            await this.onmessage?.({ data: JSON.stringify(message) });
        });
    }

    messages(type: string) {
        return this.sent.map((s) => JSON.parse(s)).filter((m) => m.type === type);
    }
}

const Consumer = () => {
    const { connect, status, errorMsg } = useSerialProxy();
    return (
        <div>
            <span data-testid="status">{status}</span>
            <span data-testid="error">{errorMsg}</span>
            <button onClick={() => connect(1)}>connect</button>
        </div>
    );
};

let port: FakePort;

const connect = async () => {
    render(<SerialProxyProvider><Consumer /></SerialProxyProvider>);
    await act(async () => { screen.getByText('connect').click(); });
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    return FakeSocket.last!;
};

const MICROWIZARD_FRAMING = { type: 'configure', baud_rate: 9600, data_bits: 8, stop_bits: 1, parity: 'N' };
const NEWBOLD_FRAMING = { type: 'configure', baud_rate: 1200, data_bits: 7, stop_bits: 2, parity: 'N' };

beforeEach(() => {
    port = new FakePort();
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('navigator', {
        ...navigator,
        serial: { requestPort: async () => port },
    });
});

describe('opening the port', () => {
    it('opens with the framing the backend asked for, then says it is ready', async () => {
        const ws = await connect();

        await ws.deliver(MICROWIZARD_FRAMING);

        expect(port.opened).toEqual([
            { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
        ]);
        expect(ws.messages('ready')).toHaveLength(1);
        expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });

    it('falls back to 8-N-1 when only a baud rate is given', async () => {
        const ws = await connect();

        await ws.deliver({ type: 'configure', baud_rate: 9600 });

        expect(port.opened[0]).toEqual({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
    });
});

describe('reopening the port to probe the next candidate', () => {
    it('closes and reopens with the new framing, and says ready again', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await ws.deliver(NEWBOLD_FRAMING);

        expect(port.closes).toBe(1);
        expect(port.opened[1]).toEqual({ baudRate: 1200, dataBits: 7, stopBits: 2, parity: 'none' });
        expect(ws.messages('ready')).toHaveLength(2);
    });

    it('leaves the WebSocket up', async () => {
        // The read loop ending normally means the device is gone, and hangs the
        // connection up. A reconfiguration ends it too — and there the backend
        // is mid-probe and about to ask for the port again.
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await ws.deliver(NEWBOLD_FRAMING);

        expect(ws.readyState).toBe(FakeSocket.OPEN);
    });

    it('releases the reader, which is what lets the port close at all', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);
        const first = port.reader;

        await ws.deliver(NEWBOLD_FRAMING);

        expect(first.released).toBe(true);
    });

    it('reads from the reopened port', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);
        await ws.deliver(NEWBOLD_FRAMING);

        await act(async () => { port.reader.push(new Uint8Array([0x4f, 0x4b])); });

        await waitFor(() => expect(ws.messages('serial_rx')).toHaveLength(1));
        expect(ws.messages('serial_rx')[0].data).toBe(btoa('OK'));
    });
});

describe('relaying', () => {
    it('writes what the backend sends to the port', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await ws.deliver({ type: 'serial_tx', data: btoa('RV') });

        expect(port.written).toHaveLength(1);
        expect(new TextDecoder().decode(port.written[0])).toBe('RV');
    });

    it('relays what the device says back to the backend', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => { port.reader.push(new Uint8Array([0x40])); });

        await waitFor(() => expect(ws.messages('serial_rx')).toHaveLength(1));
        expect(ws.messages('serial_rx')[0].data).toBe(btoa('@'));
    });
});

describe('a server-initiated close', () => {
    // A second tab or device connecting to the same track takes the timer
    // over (#301) rather than sharing it silently — the outgoing connection
    // is closed with a reason, and it needs to say so rather than reading
    // like an ordinary, unremarkable disconnect.
    it('surfaces the close reason as an error rather than a plain disconnect', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => {
            await ws.remoteClose(4000, 'Another connection took over this timer');
        });

        expect(screen.getByTestId('status')).toHaveTextContent('error');
        expect(screen.getByTestId('error')).toHaveTextContent(
            'Another connection took over this timer',
        );
    });

    it('cancels the reader before closing the port', async () => {
        // Same trap as reopening for the next probe candidate: close() rejects
        // while a reader holds the lock. FakePort.close() throws if it is
        // called before the reader has been released, so this fails without
        // the fix rather than passing by accident.
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => {
            await ws.remoteClose(4000, 'Another connection took over this timer');
        });

        expect(port.reader.released).toBe(true);
        expect(port.closes).toBe(1);
    });

    it('surfaces a role refusal the same way', async () => {
        const ws = await connect();

        await act(async () => {
            await ws.remoteClose(4403, 'Operator PIN required');
        });

        expect(screen.getByTestId('status')).toHaveTextContent('error');
        expect(screen.getByTestId('error')).toHaveTextContent('Operator PIN required');
    });

    it('still reports a plain disconnect for this tab closing its own connection', async () => {
        const ws = await connect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => { await ws.close(); });

        expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
        expect(screen.getByTestId('error')).toHaveTextContent('');
    });
});

describe('disconnecting (#331)', () => {
    // Turning the proxy off used to close the port while the read loop's
    // reader still held its lock — the same trap the reopen path (above)
    // exists to avoid. The port stayed open and locked, and the next
    // connect() got the same SerialPort object back with no way to open it.
    const DisconnectConsumer = () => {
        const { connect, disconnect, status, errorMsg } = useSerialProxy();
        return (
            <div>
                <span data-testid="status">{status}</span>
                <span data-testid="error">{errorMsg}</span>
                <button onClick={() => connect(1)}>connect</button>
                <button onClick={() => disconnect()}>disconnect</button>
            </div>
        );
    };

    const connectWithDisconnect = async () => {
        render(<SerialProxyProvider><DisconnectConsumer /></SerialProxyProvider>);
        await act(async () => { screen.getByText('connect').click(); });
        await waitFor(() => expect(FakeSocket.last).not.toBeNull());
        return FakeSocket.last!;
    };

    it('cancels the reader before closing the port', async () => {
        const ws = await connectWithDisconnect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => { screen.getByText('disconnect').click(); });

        expect(port.reader.released).toBe(true);
        expect(port.closes).toBe(1);
        expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
    });

    it('lets the next connect() reopen the same port, rather than stranding it locked', async () => {
        const ws = await connectWithDisconnect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => { screen.getByText('disconnect').click(); });
        await act(async () => { screen.getByText('connect').click(); });
        await waitFor(() => expect(FakeSocket.last).not.toBe(ws));
        await FakeSocket.last!.deliver(MICROWIZARD_FRAMING);

        expect(port.opened).toHaveLength(2);
        expect(screen.getByTestId('status')).toHaveTextContent('connected');
    });

    it('does not also run the close-reason handling for its own socket close', async () => {
        // disconnect() detaches onclose before closing the socket, so this
        // does not also fall through to the "server closed it" branch and
        // report an error for what is an ordinary, requested disconnect.
        const ws = await connectWithDisconnect();
        await ws.deliver(MICROWIZARD_FRAMING);

        await act(async () => { screen.getByText('disconnect').click(); });

        expect(screen.getByTestId('status')).toHaveTextContent('disconnected');
        expect(screen.getByTestId('error')).toHaveTextContent('');
    });
});
