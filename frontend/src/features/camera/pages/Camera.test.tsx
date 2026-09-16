// @vitest-environment jsdom
/**
 * `/camera`'s own gating messages (#177 stage 1b) — the demo refusal, the
 * insecure-context message, and the WebCodecs-missing message, each of
 * which must appear *before* anything tries to open a camera. The full
 * capture pipeline (`MediaRecorder`, `getUserMedia`) is not exercised here
 * — jsdom has neither — and is instead covered end to end by
 * `frontend/e2e/functional/instantReplay.spec.ts` through `FakeCamera`.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery } from 'urql';
import Camera from './Camera';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';
import { GET_TRACKS } from '../../core/graphql/queries';

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

function mockConfig(demoMode: boolean) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        const query = (args as { query?: unknown })?.query;
        if (query === INITIAL_CONFIG_QUERY) {
            return [{ data: { initialConfig: { demoMode } }, fetching: false, error: null }, vi.fn()];
        }
        if (query === GET_TRACKS) {
            return [{ data: { tracks: [] }, fetching: false, error: null }, vi.fn()];
        }
        return [{ data: undefined, fetching: false, error: null }, vi.fn()];
    });
}

function renderCamera(fake = false) {
    const path = fake ? '/race/1/camera?fake=1' : '/race/1/camera';
    render(
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
        expect(screen.queryByLabelText('Which track this camera listens to')).toBeNull();
    });
});

describe('browser support gating', () => {
    it('shows the WebCodecs message when VideoEncoder is missing', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', undefined);
        vi.stubGlobal('MediaStreamTrackProcessor', class {});
        renderCamera();
        expect(screen.getByText(/Use Chrome, Edge or Safari 16.4\+/)).toBeInTheDocument();
    });

    it('shows the WebCodecs message when MediaStreamTrackProcessor is missing — VideoEncoder alone is not enough for the real capture pipeline', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', class {});
        vi.stubGlobal('MediaStreamTrackProcessor', undefined);
        renderCamera();
        expect(screen.getByText(/Use Chrome, Edge or Safari 16.4\+/)).toBeInTheDocument();
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

    it('renders the track picker once support and demo mode both allow it', () => {
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
        expect(screen.getByLabelText('Which track this camera listens to')).toBeInTheDocument();
    });

    it('bypasses both gates in fake mode — CI has neither a secure context guarantee nor a real device', () => {
        mockConfig(false);
        vi.stubGlobal('VideoEncoder', undefined);
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        renderCamera(true);
        expect(screen.getByLabelText('Which track this camera listens to')).toBeInTheDocument();
        expect(screen.queryByText(/Use Chrome, Edge or Safari/)).toBeNull();
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });
});
