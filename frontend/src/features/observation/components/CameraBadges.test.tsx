// @vitest-environment jsdom
/**
 * Race Control's camera badges (#177 stage 1b) — "Finish line — connected,
 * last clip 2s ago", one per camera, rendered above the readiness strip.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CameraBadges from './CameraBadges';
import { useQuery, useSubscription } from 'urql';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(),
    };
});

function mockDisplays(displays: unknown[]) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: { displays }, fetching: false, error: null },
    ]);
    (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockReturnValue([{ data: undefined }]);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('CameraBadges', () => {
    it('renders nothing when the race has no cameras', () => {
        mockDisplays([{ displayId: 'd-1', name: 'Gym north', role: 'DISPLAY', connected: true, trackId: null, lastClipAt: null }]);
        const { container } = render(<CameraBadges raceId={1} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a connected camera by name', () => {
        mockDisplays([
            { displayId: 'c-1', name: 'Finish line', role: 'CAMERA', connected: true, trackId: 5, lastClipAt: null },
        ]);
        render(<CameraBadges raceId={1} />);
        expect(screen.getByTestId('camera-badge-c-1')).toHaveTextContent('Finish line');
        expect(screen.getByTestId('camera-badge-c-1')).toHaveTextContent('connected');
    });

    it('names how long ago the last clip landed', () => {
        const twoSecondsAgo = new Date(Date.now() - 2000).toISOString();
        mockDisplays([
            { displayId: 'c-1', name: 'Finish line', role: 'CAMERA', connected: true, trackId: 5, lastClipAt: twoSecondsAgo },
        ]);
        render(<CameraBadges raceId={1} />);
        expect(screen.getByTestId('camera-badge-c-1')).toHaveTextContent('last clip 2s ago');
    });

    it('says not connected for a camera that has gone quiet', () => {
        mockDisplays([
            { displayId: 'c-1', name: 'Finish line', role: 'CAMERA', connected: false, trackId: 5, lastClipAt: null },
        ]);
        render(<CameraBadges raceId={1} />);
        expect(screen.getByTestId('camera-badge-c-1')).toHaveTextContent('not connected');
    });

    it('ignores an ordinary display row entirely', () => {
        mockDisplays([
            { displayId: 'c-1', name: 'Finish line', role: 'CAMERA', connected: true, trackId: 5, lastClipAt: null },
            { displayId: 'd-1', name: 'Gym north', role: 'DISPLAY', connected: true, trackId: null, lastClipAt: null },
        ]);
        render(<CameraBadges raceId={1} />);
        expect(screen.getByTestId('camera-badges').children).toHaveLength(1);
    });

    it('prefers the live subscription over the initial query once it answers', () => {
        (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                data: { displays: [{ displayId: 'c-1', name: 'Stale', role: 'CAMERA', connected: false, trackId: null, lastClipAt: null }] },
                fetching: false,
                error: null,
            },
        ]);
        (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                data: { displays: [{ displayId: 'c-1', name: 'Fresh', role: 'CAMERA', connected: true, trackId: null, lastClipAt: null }] },
            },
        ]);
        render(<CameraBadges raceId={1} />);
        expect(screen.getByTestId('camera-badge-c-1')).toHaveTextContent('Fresh');
    });
});
