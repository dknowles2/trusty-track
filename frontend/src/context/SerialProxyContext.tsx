import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface SerialProxyContextType {
    status: ConnectionStatus;
    errorMsg: string | null;
    activeTrackId: number | null;
    connect: (trackId: number) => Promise<void>;
    disconnect: () => void;
    isSupported: boolean;
}

const SerialProxyContext = createContext<SerialProxyContextType | undefined>(undefined);

interface SerialPort {
    readable: { getReader: () => { read: () => Promise<{ value: Uint8Array, done: boolean }>, releaseLock: () => void } };
    writable: { getWriter: () => { write: (data: Uint8Array) => Promise<void>, releaseLock: () => void } };
    open: (options: {
        baudRate: number;
        dataBits?: number;
        stopBits?: number;
        parity?: 'none' | 'even' | 'odd';
    }) => Promise<void>;
    close: () => Promise<void>;
}

/**
 * The port framing the backend asked for.
 *
 * The backend describes a device in pyserial's terms, because that is what the
 * backend-direct path opens the port with. Web Serial spells the same three
 * settings differently, so the translation happens here rather than the server
 * carrying two vocabularies for one device.
 */
const PARITY: Record<string, 'none' | 'even' | 'odd'> = {
    N: 'none',
    E: 'even',
    O: 'odd',
};

interface ConfigureMessage {
    baud_rate: number;
    data_bits?: number;
    stop_bits?: number;
    parity?: string;
}

const portOptions = (msg: ConfigureMessage) => ({
    baudRate: msg.baud_rate,
    // Web Serial defaults to 8-N-1, which is also what these fall back to. An
    // older backend that sends only the baud rate therefore behaves as before.
    dataBits: msg.data_bits ?? 8,
    stopBits: msg.stop_bits ?? 1,
    parity: PARITY[msg.parity ?? 'N'] ?? 'none',
});

export const SerialProxyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<number | null>(null);

    // Using any for Web Serial API as it might not be in the default TS lib
    // but defining a minimal interface would be better if we had one.
    const portRef = useRef<SerialPort | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

    const startReading = useCallback(async (port: SerialPort, ws: WebSocket) => {
        while (port.readable && ws.readyState === WebSocket.OPEN) {
            const reader = port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const decoded = new TextDecoder().decode(value);
                    console.log('Serial PROXY RX:', decoded.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
                    ws.send(JSON.stringify({
                        type: 'serial_rx',
                        data: btoa(String.fromCharCode(...value))
                    }));
                }
            } catch (err: unknown) {
                console.error('Serial read error:', err);
                break;
            } finally {
                reader.releaseLock();
            }
        }
        // Device was unplugged or read loop ended — close the WebSocket so the
        // backend transitions to DISCONNECTED and ws.onclose updates our status.
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            console.log('Serial device disconnected, closing WebSocket');
            ws.close();
        }
    }, []);

    const disconnect = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        portRef.current?.close();
        portRef.current = null;
        setStatus('disconnected');
        setActiveTrackId(null);
    }, []);

    const connect = useCallback(async (trackId: number) => {
        if (!isSupported) return;

        // If already connected to the same track, do nothing
        if (status === 'connected' && activeTrackId === trackId) return;

        // If connected to a different track, disconnect first
        if (status !== 'disconnected') {
            disconnect();
        }

        try {
            setStatus('connecting');
            setErrorMsg(null);
            setActiveTrackId(trackId);

            // 1. Request port (shows browser dialog)
            const port = await (navigator as unknown as { serial: { requestPort: () => Promise<SerialPort> } }).serial.requestPort();

            // 2. Open WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/timer/${trackId}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Handshake: Proxy WebSocket opened');
            };

            ws.onmessage = async (event) => {
                console.log('Handshake: Received message:', event.data);
                const msg = JSON.parse(event.data);
                if (msg.type === 'configure') {
                    try {
                        const options = portOptions(msg);
                        console.log('Handshake: Configuring port:', options);
                        await port.open(options);
                        portRef.current = port;
                        console.log('Handshake: Port opened successfully, sending ready');
                        ws.send(JSON.stringify({ type: 'ready' }));
                        setStatus('connected');
                        startReading(port, ws);
                    } catch (err: unknown) {
                        const e = err as { message?: string };
                        setErrorMsg(`Port error: ${e.message}`);
                        setStatus('error');
                        ws.close();
                    }
                } else if (msg.type === 'serial_tx') {
                    if (port.writable) {
                        const writer = port.writable.getWriter();
                        const data = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
                        const decodedTx = new TextDecoder().decode(data);
                        console.log('Serial PROXY TX:', decodedTx.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
                        await writer.write(data);
                        writer.releaseLock();
                    }
                }
            };

            ws.onclose = () => {
                setStatus('disconnected');
                portRef.current?.close();
                portRef.current = null;
                setActiveTrackId(null);
            };

            ws.onerror = () => {
                setErrorMsg('WebSocket connection failed');
                setStatus('error');
            };

        } catch (err: unknown) {
            const e = err as { name?: string, message?: string };
            if (e.name === 'NotFoundError') {
                setStatus('disconnected');
                setActiveTrackId(null);
            } else {
                setErrorMsg(e.message || 'Connection failed');
                setStatus('error');
            }
        }
    }, [isSupported, status, activeTrackId, disconnect, startReading]);

    // Clean up on app unmount
    useEffect(() => {
        return () => {
            wsRef.current?.close();
            portRef.current?.close();
        };
    }, []);

    return (
        <SerialProxyContext.Provider value={{ status, errorMsg, activeTrackId, connect, disconnect, isSupported }}>
            {children}
        </SerialProxyContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSerialProxy = () => {
    const context = useContext(SerialProxyContext);
    if (context === undefined) {
        throw new Error('useSerialProxy must be used within a SerialProxyProvider');
    }
    return context;
};
