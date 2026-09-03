// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckInScanner from './CheckInScanner';

const RACERS = [
    { id: 7, first_name: 'Alex', last_name: 'Rivera', car_number: 3 },
    { id: 8, first_name: 'Sam', last_name: 'Okafor', car_number: 12 },
];

const RACERS_WITH_DUPLICATE = [
    ...RACERS,
    { id: 9, first_name: 'Jamie', last_name: 'Chen', car_number: 12 },
];

/** What the camera "sees". Each call returns the next queued payload. */
let payloads: string[] = [];
const stopTrack = vi.fn();

function withScanning() {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
        async detect() {
            const next = payloads.shift();
            return next ? [{ rawValue: next }] : [];
        }
    };
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: stopTrack }],
            }),
        },
    });
    // jsdom never decodes video, so `readyState` stays at 0 and the scan loop
    // would sit out every frame. HAVE_CURRENT_DATA is what a real camera
    // reaches within a frame or two of the stream attaching.
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true,
        get: () => 2,
    });
}

beforeEach(() => {
    payloads = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
});

function open(onRacer = vi.fn(), onClose = vi.fn(), racers = RACERS) {
    render(
        <CheckInScanner raceId={1} racers={racers} onRacer={onRacer} onClose={onClose} />,
    );
    return { onRacer, onClose };
}

/** Let the scan loop run a few times. */
async function scanFrames() {
    await vi.advanceTimersByTimeAsync(600);
}

describe('CheckInScanner where the browser can scan', () => {
    beforeEach(withScanning);

    it('opens the camera and hands over the racer it read', async () => {
        payloads = ['TT1:1:7'];
        const { onRacer } = open();

        await waitFor(() => expect(screen.getByTestId('scanner-video')).toBeInTheDocument());
        await scanFrames();

        expect(onRacer).toHaveBeenCalledWith(7);
    });

    it('will not check in a racer from another race', async () => {
        // The failure this guards is checking in the wrong child: racer 7
        // exists here too, so a code from race 2 must not resolve.
        payloads = ['TT1:2:7'];
        const { onRacer } = open();
        await scanFrames();

        expect(onRacer).not.toHaveBeenCalled();
        expect(await screen.findByText(/different race/)).toBeInTheDocument();
    });

    it('says a foreign QR code is not one of ours', async () => {
        payloads = ['https://example.com'];
        open();
        await scanFrames();

        expect(
            await screen.findByText('That is not a Trusty Track code.'),
        ).toBeInTheDocument();
    });

    it('reports a code whose racer has been deleted since it was printed', async () => {
        payloads = ['TT1:1:99'];
        open();
        await scanFrames();

        expect(await screen.findByText(/no longer on this roster/)).toBeInTheDocument();
    });

    it('releases the camera when it goes away', async () => {
        open();
        await waitFor(() => expect(screen.getByTestId('scanner-video')).toBeInTheDocument());

        cleanup();

        await waitFor(() => expect(stopTrack).toHaveBeenCalled());
    });

    it('offers car-number entry even though it can scan', async () => {
        // A creased code with a queue behind the table.
        const { onRacer } = open();

        await userEvent.type(screen.getByLabelText('Car number'), '12');
        await userEvent.click(screen.getByRole('button', { name: /Find/ }));

        expect(onRacer).toHaveBeenCalledWith(8);
    });
});

describe('CheckInScanner where the browser cannot scan', () => {
    it('says so, and still finds a racer by car number', async () => {
        // Safari and Firefox have no BarcodeDetector.
        const { onRacer } = open();

        expect(screen.getByText(/cannot scan QR codes/)).toBeInTheDocument();
        expect(screen.queryByTestId('scanner-video')).not.toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Car number'), '3');
        await userEvent.click(screen.getByRole('button', { name: /Find/ }));

        expect(onRacer).toHaveBeenCalledWith(7);
    });

    it('does not ask for the camera at all', () => {
        const getUserMedia = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });

        open();

        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('reports a car number nobody has', async () => {
        const { onRacer } = open();

        await userEvent.type(screen.getByLabelText('Car number'), '404');
        await userEvent.click(screen.getByRole('button', { name: /Find/ }));

        expect(onRacer).not.toHaveBeenCalled();
        expect(screen.getByText('No racer has car number 404.')).toBeInTheDocument();
    });

    it('says so, not that the car does not exist, when two racers share the number', async () => {
        // #336: the operator is holding a car clearly numbered 12 — telling
        // them nobody has it is the opposite of the situation.
        const { onRacer } = open(vi.fn(), vi.fn(), RACERS_WITH_DUPLICATE);

        await userEvent.type(screen.getByLabelText('Car number'), '12');
        await userEvent.click(screen.getByRole('button', { name: /Find/ }));

        expect(onRacer).not.toHaveBeenCalled();
        expect(
            screen.getByText(
                'More than one racer has car number 12 — find them by name.',
            ),
        ).toBeInTheDocument();
    });
});

describe('CheckInScanner when the camera will not open', () => {
    it('falls back to typing rather than showing a dead frame', async () => {
        (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {};
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        open();

        expect(await screen.findByText(/Could not open the camera/)).toBeInTheDocument();
        expect(screen.getByLabelText('Car number')).toBeInTheDocument();
    });
});

describe('CheckInScanner over an insecure origin (#593)', () => {
    // TRUSTYTRACK_HTTP_ONLY, or a second device reached by plain
    // http://<lan-ip>: `navigator.mediaDevices` does not exist at all, so a
    // volunteer must not be told this looks like a permissions refusal.
    afterEach(() => {
        Object.defineProperty(window, 'isSecureContext', {
            configurable: true,
            value: undefined,
        });
    });

    it('explains the secure-connection requirement rather than blaming permissions', async () => {
        (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {};
        Object.defineProperty(window, 'isSecureContext', {
            configurable: true,
            value: false,
        });
        const getUserMedia = vi.fn();
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });

        open();

        expect(
            await screen.findByText(/needs a secure connection/),
        ).toBeInTheDocument();
        expect(screen.getByLabelText('Car number')).toBeInTheDocument();
        // Never even asked — no permissions prompt to blame.
        expect(getUserMedia).not.toHaveBeenCalled();
    });
});
