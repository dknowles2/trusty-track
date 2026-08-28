// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import { SerialProxyProvider } from '../../../context/SerialProxyContext';
import { useQuery, useSubscription, useMutation } from 'urql';
import TimerDiagnostics from './TimerDiagnostics';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(),
        useMutation: vi.fn(),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const track = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    name: 'Main Track',
    timerType: 'AUTO_DETECT_BACKEND',
    serialPort: null,
    laneCount: 4,
    ...over,
});

function setup(
    tracks: unknown[],
    status: Record<string, unknown> | null,
    route = '/timer-check',
) {
    (useQuery as any).mockReturnValue([{ data: { tracks }, fetching: false, error: null }]);
    (useSubscription as any).mockReturnValue([
        { data: status ? { timerStatus: { trackId: 1, status } } : undefined },
    ]);
    (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

    render(
        <MemoryRouter initialEntries={[route]}>
            <AlertProvider>
                <TimerDiagnostics />
            </AlertProvider>
        </MemoryRouter>
    );
}

// A proxy track's "Connect" affordance is `SerialProxyConnector`, the same
// component RaceExecution and FreeRaceExecution mount — and it reads
// `navigator.serial` through `SerialProxyProvider`, which App.tsx wraps this
// route in. Both are real here rather than mocked, the same way the page
// reaches them in the app.
function setupProxyTrack(
    tracks: unknown[],
    status: Record<string, unknown> | null,
    route = '/timer-check',
) {
    (useQuery as any).mockReturnValue([{ data: { tracks }, fetching: false, error: null }]);
    (useSubscription as any).mockReturnValue([
        { data: status ? { timerStatus: { trackId: 1, status } } : undefined },
    ]);
    (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);

    render(
        <MemoryRouter initialEntries={[route]}>
            <AlertProvider>
                <SerialProxyProvider>
                    <TimerDiagnostics />
                </SerialProxyProvider>
            </AlertProvider>
        </MemoryRouter>
    );
}

describe('TimerDiagnostics', () => {
    it('says which port the timer was found on', async () => {
        // The point of the page for a backend-connected track: the port is
        // discovered rather than configured (#89), so "which one did it pick"
        // is otherwise unanswerable from the operator's side.
        setup([track()], {
            state: 'IDLE',
            deviceName: 'MicroWizard K1/K2/K3',
            port: '/dev/ttyUSB1',
            laneCount: 4,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText('/dev/ttyUSB1', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('found automatically')).toBeInTheDocument();
        expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it('does not claim a hand-configured port was found', async () => {
        setup([track({ serialPort: '/dev/ttyUSB0' })], {
            state: 'IDLE',
            deviceName: 'MicroWizard K1/K2/K3',
            port: '/dev/ttyUSB0',
            laneCount: 4,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText('/dev/ttyUSB0', { exact: false })).toBeInTheDocument();
        expect(screen.queryByText('found automatically')).not.toBeInTheDocument();
    });

    it('explains what a port that opened but never answered means', async () => {
        // CONNECTED is the state that used to strand a working timer (#93),
        // and it is still what you see when the port is simply not a timer.
        // Either way the operator needs to know whether to wait or unplug.
        setup([track()], {
            state: 'CONNECTED',
            deviceName: 'MicroWizard K1/K2/K3',
            port: '/dev/ttyUSB0',
            laneCount: null,
            lastError: null,
            serialLog: [],
        });

        expect(
            await screen.findByText('Port open, waiting for the timer to answer')
        ).toBeInTheDocument();
        expect(screen.getByText(/probably not the timer/)).toBeInTheDocument();
    });

    it('shows the reason a search failed', async () => {
        setup([track()], {
            state: 'DISCONNECTED',
            deviceName: 'MicroWizard K1/K2/K3',
            port: null,
            laneCount: null,
            lastError: 'No timer answered on /dev/ttyUSB0. Check the cable.',
            serialLog: [],
        });

        expect(await screen.findByText(/No timer answered/)).toBeInTheDocument();
    });

    it('annotates the serial traffic', async () => {
        setup([track()], {
            state: 'IDLE',
            deviceName: 'MicroWizard K1/K2/K3',
            port: '/dev/ttyUSB0',
            laneCount: 4,
            lastError: null,
            serialLog: [
                { direction: 'TX', data: 'RV', timestamp: '' },
                { direction: 'RX', data: 'Copyright (c) Micro Wizard 2002-2009\\r\\n', timestamp: '' },
            ],
        });

        expect(await screen.findByText('request version')).toBeInTheDocument();
        expect(screen.getByText('timer identified itself')).toBeInTheDocument();
    });

    it('says there is nothing to check on a fake timer', async () => {
        setup([track({ timerType: 'FAKE' })], {
            state: 'IDLE',
            deviceName: 'Fake Timer',
            port: null,
            laneCount: null,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText(/no hardware to check/)).toBeInTheDocument();
        expect(screen.queryByText('Serial traffic')).not.toBeInTheDocument();
    });

    it('offers to search when no port is configured', async () => {
        setup([track()], null);

        expect(await screen.findByText('Search for the timer')).toBeInTheDocument();
    });

    it('offers to connect to a port that was configured by hand', async () => {
        setup([track({ serialPort: '/dev/ttyUSB0' })], null);

        expect(await screen.findByText('Connect')).toBeInTheDocument();
    });

    it('says when a device description has never been run against hardware', async () => {
        // Most profiles are adapted from DerbyNet and have never been near the
        // timer they describe. A device name alone implies support we do not
        // have.
        setup([track()], {
            state: 'IDLE',
            deviceName: 'PDT timer (dfgtec.com/pdt)',
            deviceProvenance:
                "Adapted from DerbyNet's PDT profile (MIT). Never run against this hardware.",
            port: '/dev/ttyUSB0',
            laneCount: 4,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText(/Never run against this hardware/)).toBeInTheDocument();
    });

    it('points at settings when there are no tracks', async () => {
        setup([], null);

        expect(await screen.findByText(/No tracks are configured/)).toBeInTheDocument();
    });
});

describe('a proxy track (#330)', () => {
    const proxyTrack = (over: Partial<Record<string, unknown>> = {}) =>
        track({ timerType: 'AUTO_DETECT_PROXY', ...over });

    it('mounts a Connect affordance instead of pointing at a button that does not exist', async () => {
        // Before the fix, a proxied track rendered only Reset here — the
        // backend-only Connect/Search button never applied to it, and there
        // was no proxy connector to take its place.
        Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
        try {
            setupProxyTrack([proxyTrack()], {
                state: 'DISCONNECTED',
                deviceName: null,
                port: null,
                laneCount: null,
                lastError: null,
                serialLog: [],
            });

            expect(await screen.findByText('Connect Hardware Timer')).toBeInTheDocument();
            expect(screen.queryByText('Connect')).not.toBeInTheDocument();
            expect(screen.queryByText('Search for the timer')).not.toBeInTheDocument();
        } finally {
            delete (navigator as { serial?: unknown }).serial;
        }
    });

    it('offers the connector even without Web Serial support, rather than nothing', async () => {
        // jsdom has no `navigator.serial`, which is also true of Safari and
        // Firefox. Either way the operator gets an explanation, not a dead
        // page.
        setupProxyTrack([proxyTrack()], {
            state: 'DISCONNECTED',
            deviceName: null,
            port: null,
            laneCount: null,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText(/Web Serial not supported/)).toBeInTheDocument();
    });

    it('tells a disconnected proxy track to use the connector, not "press Connect"', async () => {
        setupProxyTrack([proxyTrack()], {
            state: 'DISCONNECTED',
            deviceName: null,
            port: null,
            laneCount: null,
            lastError: null,
            serialLog: [],
        });

        expect(
            await screen.findByText(/use Connect Hardware Timer below/)
        ).toBeInTheDocument();
        expect(screen.queryByText(/press Connect/)).not.toBeInTheDocument();
    });

    it('leaves the backend-track help text alone', async () => {
        setup([track({ timerType: 'AUTO_DETECT_BACKEND' })], {
            state: 'DISCONNECTED',
            deviceName: null,
            port: null,
            laneCount: null,
            lastError: null,
            serialLog: [],
        });

        expect(await screen.findByText(/press Connect/)).toBeInTheDocument();
    });
});

describe('reaching one track from its settings card', () => {
    it('gives every track a section the card can address', () => {
        // The link on a track's card is `/timer-check#timer-<id>`. Without the
        // id the link still lands on the page, and a venue with three tracks
        // gets three live panels and no idea which is theirs — a failure that
        // looks like nothing being wrong.
        setup([track({ id: 7 })], null);

        expect(document.getElementById('timer-7')?.tagName).toBe('SECTION');
    });

    it('marks the track that was asked for', () => {
        // Scrolling to it is not enough on its own: a page whose panels all
        // fit does not scroll, and then arriving from one track's card looks
        // exactly like arriving from the nav.
        setup([track({ id: 7 }), track({ id: 8, name: 'Back Gym' })], null, '/timer-check#timer-8');

        expect(document.getElementById('timer-8')!.style.boxShadow).toContain('cub-scouting-gold');
        expect(document.getElementById('timer-7')!.style.boxShadow).toBe('');
    });
});
