// @vitest-environment jsdom
/**
 * `/camera`'s own gating messages (#177 stage 1b) — the demo refusal, the
 * insecure-context message, and the WebCodecs-missing message, each of
 * which must appear *before* anything tries to open a camera. The full
 * capture pipeline (`MediaRecorder`, `getUserMedia`) is not exercised here
 * — jsdom has neither — and is instead covered end to end by
 * `frontend/e2e/functional/instantReplay.spec.ts` through `FakeCamera`.
 *
 * Also covers registering against the race's own track (#1293): a race
 * runs on exactly one track, so this page has no dropdown of its own — it
 * registers automatically on connect, preferring a `?trackId=` in the URL
 * only when it names this race's own track.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useMutation, useQuery, useSubscription } from 'urql';
import Camera from './Camera';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';
import { GET_TRACKS } from '../../core/graphql/queries';
import { DisplayAssignmentSubscription, RACE_TRACK_QUERY, SET_CAMERA_TRACK } from '../../observation/graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(() => [{ fetching: false }, vi.fn()]),
        useClient: vi.fn(() => ({ query: vi.fn(() => ({ toPromise: () => Promise.resolve({ data: {} }) })) })),
    };
});

/**
 * `raceTrackId` defaults to `null` — "this race's own track query has
 * answered, and the race has none" — rather than to the unanswered/pending
 * state, so a test that doesn't care about the registration behaviour
 * doesn't have to think about it. Pass `null` explicitly for "no track",
 * or a number for "this race's own track is set".
 */
function mockConfig(
    demoMode: boolean,
    tracks: { id: number; name: string; timerType: string }[] = [],
    raceTrackId: number | null = null,
) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        const query = (args as { query?: unknown })?.query;
        if (query === INITIAL_CONFIG_QUERY) {
            return [{ data: { initialConfig: { demoMode } }, fetching: false, error: null }, vi.fn()];
        }
        if (query === GET_TRACKS) {
            return [{ data: { tracks }, fetching: false, error: null }, vi.fn()];
        }
        if (query === RACE_TRACK_QUERY) {
            return [{ data: { race: { id: 1, trackId: raceTrackId } }, fetching: false, error: null }, vi.fn()];
        }
        return [{ data: undefined, fetching: false, error: null }, vi.fn()];
    });
}

/** Discriminates `useSubscription` by document, so a test can hand the
 * camera page a specific `displayAssignment` payload (in particular, its
 * own `trackId`) while every other subscription answers nothing — the same
 * shape `mockConfig` already gives `useQuery`. */
function mockAssignment(trackId: number | null | undefined) {
    (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        const query = (args as { query?: unknown })?.query;
        if (query === DisplayAssignmentSubscription) {
            return [
                { data: { displayAssignment: { displayId: 'cam-1', name: 'Camera', trackId: trackId ?? null, identifySeq: null } } },
                vi.fn(),
            ];
        }
        return [{ data: undefined }, vi.fn()];
    });
}

function mockSetCameraTrack() {
    const spy = vi.fn().mockResolvedValue({ data: {} });
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
        if (query === SET_CAMERA_TRACK) return [{ fetching: false }, spy];
        return [{ fetching: false }, vi.fn()];
    });
    return spy;
}

function renderCamera(fake = false, extraParams = '') {
    const path = fake ? `/race/1/camera?fake=1${extraParams}` : `/race/1/camera${extraParams}`;
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/race/:raceId/camera" element={<Camera />} />
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('the demo gate', () => {
    it('refuses outright on the demo, with no camera controls', () => {
        mockConfig(true);
        renderCamera();
        expect(screen.getByText(/Cameras are off on the public demo/)).toBeInTheDocument();
        expect(screen.queryByTestId('camera-status-line')).toBeNull();
    });
});

/** Restores `navigator.userAgent` after a test that stubs it — used only by
 * the iOS-specific cases below, since every other test here relies on
 * jsdom's own default (non-iOS) UA and needs no override at all. */
function stubUserAgent(ua: string): () => void {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    return () => Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true });
}

const IPHONE_SAFARI_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.80 Mobile/15E148 Safari/604.1';

/** Shared by the two tests that need capture to actually proceed on jsdom —
 * `MediaStreamTrackProcessor` absent, no camera device to open — without
 * the capture effect's own rejection throwing past the render. */
function stubNoRealCamera(): void {
    Object.defineProperty(navigator, 'mediaDevices', {
        value: {
            getUserMedia: vi.fn().mockRejectedValue(new Error('no camera in jsdom')),
            enumerateDevices: vi.fn().mockResolvedValue([]),
        },
        configurable: true,
    });
}

describe('browser support gating', () => {
    it('shows the WebCodecs message when VideoEncoder is missing', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', undefined);
        vi.stubGlobal('MediaStreamTrackProcessor', class {});
        renderCamera();
        expect(screen.getByText(/Use Chrome, Edge or Safari 16.4\+/)).toBeInTheDocument();
    });

    it('shows the iOS-specific message on an iPhone with no VideoEncoder — never names Chrome or Edge', () => {
        const restore = stubUserAgent(IPHONE_SAFARI_UA);
        try {
            mockConfig(false);
            vi.stubGlobal('VideoEncoder', undefined);
            vi.stubGlobal('MediaStreamTrackProcessor', undefined);
            renderCamera();
            expect(screen.getByText(/Instant replay needs a newer iOS/)).toBeInTheDocument();
            expect(screen.queryByText(/Chrome|Edge/)).toBeNull();
        } finally {
            restore();
        }
    });

    it('shows the iOS-specific message on an iPhone running Chrome — the UA names Chrome, but switching to it changes nothing on iOS', () => {
        const restore = stubUserAgent(IPHONE_CHROME_UA);
        try {
            mockConfig(false);
            vi.stubGlobal('VideoEncoder', undefined);
            vi.stubGlobal('MediaStreamTrackProcessor', undefined);
            renderCamera();
            expect(screen.getByText(/Instant replay needs a newer iOS/)).toBeInTheDocument();
        } finally {
            restore();
        }
    });

    it('shows no message, and renders the camera page, when only MediaStreamTrackProcessor is missing — capture.ts\'s canvas frame source covers it', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', class {});
        vi.stubGlobal('MediaStreamTrackProcessor', undefined);
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        stubNoRealCamera();
        renderCamera();
        expect(screen.getByTestId('camera-status-line')).toBeInTheDocument();
        expect(screen.queryByText(/Use Chrome, Edge or Safari/)).toBeNull();
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });

    it('shows no message on an iPhone with VideoEncoder but no MediaStreamTrackProcessor — the fallback applies there too', () => {
        const restore = stubUserAgent(IPHONE_SAFARI_UA);
        try {
            mockConfig(false);
            vi.stubGlobal('VideoEncoder', class {});
            vi.stubGlobal('MediaStreamTrackProcessor', undefined);
            Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
            stubNoRealCamera();
            renderCamera();
            expect(screen.getByTestId('camera-status-line')).toBeInTheDocument();
            expect(screen.queryByText(/Instant replay needs a newer iOS/)).toBeNull();
        } finally {
            restore();
        }
    });

    it('shows the insecure-context message over plain HTTP off localhost', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', class {});
        vi.stubGlobal('MediaStreamTrackProcessor', class {});
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        renderCamera();
        expect(screen.getByText(/plain HTTP/)).toBeInTheDocument();
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });

    it('renders the camera page once support and demo mode both allow it, with no track dropdown (#1293)', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', class {});
        vi.stubGlobal('MediaStreamTrackProcessor', class {});
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        // jsdom has no getUserMedia at all — stub the minimum this render
        // needs so the capture effect's rejection is handled quietly
        // rather than throwing on an undefined `navigator.mediaDevices`.
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockRejectedValue(new Error('no camera in jsdom')),
                enumerateDevices: vi.fn().mockResolvedValue([]),
            },
            configurable: true,
        });
        renderCamera();
        expect(screen.getByTestId('camera-status-line')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('bypasses both gates in fake mode — CI has neither a secure context guarantee nor a real device', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', undefined);
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        renderCamera(true);
        expect(screen.getByTestId('camera-status-line')).toBeInTheDocument();
        expect(screen.queryByText(/Use Chrome, Edge or Safari/)).toBeNull();
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });
});

describe('registering against the race’s own track, with no picker (#1293)', () => {
    // Every test here needs its own `useSubscription`/`useMutation`
    // implementation (to hand the page a specific `displayAssignment` and to
    // spy on `setCameraTrack`) — restored to the file's own plain defaults
    // afterward so a later test in this file is not left reading this
    // block's own mocks.
    afterEach(() => {
        (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockImplementation(() => [
            { data: undefined },
            vi.fn(),
        ]);
        (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(() => [
            { fetching: false },
            vi.fn(),
        ]);
    });

    it('auto-registers against the race’s own track when the assignment has none and no param is present', async () => {
        mockConfig(false, [{ id: 8, name: 'Green Track', timerType: 'FAKE' }], 8);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(null);

        renderCamera(true);

        await waitFor(() => {
            expect(setCameraTrack).toHaveBeenCalledWith({ displayId: expect.any(String), trackId: 8 });
        });
        expect(setCameraTrack).toHaveBeenCalledTimes(1);
    });

    it('applies a `?trackId=` that names this race’s own track', async () => {
        mockConfig(false, [{ id: 5, name: 'Blue Track', timerType: 'FAKE' }], 5);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(null);

        renderCamera(true, '&trackId=5');

        await waitFor(() => {
            expect(setCameraTrack).toHaveBeenCalledWith({ displayId: expect.any(String), trackId: 5 });
        });
        expect(setCameraTrack).toHaveBeenCalledTimes(1);
    });

    it('ignores a `?trackId=` naming another race’s track, and registers this race’s own track instead', async () => {
        mockConfig(false, [{ id: 5, name: 'Blue Track', timerType: 'FAKE' }], 5);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(null);

        // 999 names no track this race has anything to do with — an old
        // client's stale code, or a typo.
        renderCamera(true, '&trackId=999');

        await waitFor(() => {
            expect(setCameraTrack).toHaveBeenCalledWith({ displayId: expect.any(String), trackId: 5 });
        });
        expect(setCameraTrack).toHaveBeenCalledTimes(1);
    });

    it('does not apply anything when the assignment already carries a track', async () => {
        mockConfig(false, [{ id: 5, name: 'Blue Track', timerType: 'FAKE' }], 5);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(7);

        renderCamera(true, '&trackId=5');

        await waitFor(() => {
            expect(screen.getByTestId('camera-status-line')).toBeInTheDocument();
        });
        expect(setCameraTrack).not.toHaveBeenCalled();
    });

    it('does nothing when this race has no track set yet', async () => {
        mockConfig(false, [], null);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(null);

        renderCamera(true);

        await waitFor(() => {
            expect(screen.getByText(/This race has no track set yet/)).toBeInTheDocument();
        });
        expect(setCameraTrack).not.toHaveBeenCalled();
    });

    it('never re-applies on a later render of the same page', async () => {
        mockConfig(false, [{ id: 5, name: 'Blue Track', timerType: 'FAKE' }], 5);
        const setCameraTrack = mockSetCameraTrack();
        mockAssignment(null);

        const { rerender } = renderCamera(true, '&trackId=5');
        await waitFor(() => expect(setCameraTrack).toHaveBeenCalledTimes(1));

        // The same tree, at the same route — the ordinary case a re-render
        // is provoked by (a subscription tick, another query answering),
        // not a fresh mount.
        rerender(
            <MemoryRouter initialEntries={['/race/1/camera?fake=1&trackId=5']}>
                <Routes>
                    <Route path="/race/:raceId/camera" element={<Camera />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(setCameraTrack).toHaveBeenCalledTimes(1);
    });

    it('renders no track dropdown, whatever the assignment holds', async () => {
        mockConfig(false, [{ id: 5, name: 'Blue Track', timerType: 'FAKE' }], 5);
        mockSetCameraTrack();
        mockAssignment(5);

        renderCamera(true);

        await waitFor(() => {
            expect(screen.getByTestId('camera-status-line')).toHaveTextContent("Listening to Blue Track's timer");
        });
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.queryByLabelText(/Which track/)).toBeNull();
    });
});
