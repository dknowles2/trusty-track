// @vitest-environment jsdom
/**
 * #177 stage 1b — the Displays panel's own camera-role and replays-toggle
 * additions. `DisplaysPanel.test.tsx` covers the pre-existing view/rider
 * controls; this file is scoped to what stage 1b added on top of them —
 * updated by #1293 for the row's read-only track line and its one override
 * affordance, in place of the picker stage 1b originally gave it.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import { ASSIGN_DISPLAY, SET_CAMERA_TRACK } from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
        useMutation: vi.fn(),
        useClient: vi.fn(),
    };
});

const assignDisplay = vi.fn().mockResolvedValue({ data: {} });
const setCameraTrack = vi.fn().mockResolvedValue({ data: {} });

interface DisplayFixture {
    displayId: string;
    name: string;
    role: 'DISPLAY' | 'CAMERA';
    view: string;
    replays: boolean;
    trackId: number | null;
    lastClipAt: string | null;
    connected: boolean;
}

/** `raceTrackId` defaults to `5` — the same track `GET_TRACKS` hands back
 * as "Main Track" — so a `CAMERA_ROW` fixture (below) whose own `trackId`
 * also defaults to `5` reads as an ordinary, already-matching camera and
 * shows no override button unless a test deliberately sets one or the
 * other to something else. */
function renderPanel(display: DisplayFixture, raceTrackId: number | null = 5) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        const queryArg = (args as { query?: { definitions?: { name?: { value?: string } }[] } })?.query;
        const name = queryArg?.definitions?.find((d) => d.name?.value)?.name?.value;
        if (name === 'RaceAwardCount') {
            return [{ data: { race: { id: 1, awards: [] } }, fetching: false, error: null }, vi.fn()];
        }
        if (name === 'GetTracks') {
            return [{ data: { tracks: [{ id: 5, name: 'Main Track', timerType: 'FAKE' }] }, fetching: false, error: null }, vi.fn()];
        }
        if (name === 'RaceTrackForCameraPreset') {
            return [{ data: { race: { id: 1, trackId: raceTrackId } }, fetching: false, error: null }, vi.fn()];
        }
        return [{ data: { displays: [display] }, fetching: false, error: null }, vi.fn()];
    });

    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
        if (query === ASSIGN_DISPLAY) return [{ fetching: false }, assignDisplay];
        if (query === SET_CAMERA_TRACK) return [{ fetching: false }, setCameraTrack];
        return [{ fetching: false }, vi.fn()];
    });
    (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });

    render(<DisplaysPanel raceId={1} />);
}

const DISPLAY_ROW: DisplayFixture = {
    displayId: 'd-1',
    name: 'Gym north',
    role: 'DISPLAY',
    view: 'STANDINGS',
    replays: true,
    trackId: null,
    lastClipAt: null,
    connected: true,
};

const CAMERA_ROW: DisplayFixture = {
    displayId: 'c-1',
    name: 'Finish line',
    role: 'CAMERA',
    view: 'STANDINGS',
    replays: true,
    trackId: 5,
    lastClipAt: null,
    connected: true,
};

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('the Replays toggle on an ordinary display row', () => {
    it('is on by default, matching the server default', async () => {
        renderPanel(DISPLAY_ROW);
        await waitFor(() => {
            expect(screen.getByLabelText('Whether Gym north plays replays')).toBeChecked();
        });
    });

    it('reflects the row being turned off', async () => {
        renderPanel({ ...DISPLAY_ROW, replays: false });
        await waitFor(() => {
            expect(screen.getByLabelText('Whether Gym north plays replays')).not.toBeChecked();
        });
    });

    it('calls assignDisplay with replays when toggled', async () => {
        renderPanel(DISPLAY_ROW);
        await waitFor(() => {
            expect(screen.getByLabelText('Whether Gym north plays replays')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByLabelText('Whether Gym north plays replays'));
        expect(assignDisplay).toHaveBeenCalledWith({
            displayId: 'd-1',
            view: 'STANDINGS',
            replays: false,
        });
    });

    it('offers no camera track line or override on an ordinary display', async () => {
        renderPanel(DISPLAY_ROW);
        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });
        expect(screen.queryByText(/Listening to/)).toBeNull();
        expect(screen.queryByRole('button', { name: "Use this race's track" })).toBeNull();
    });
});

describe('a CAMERA row (#1293 — a read-only line, not a picker)', () => {
    it('shows a read-only track line instead of a view select', async () => {
        renderPanel(CAMERA_ROW);
        await waitFor(() => {
            expect(screen.getByText('Listening to Main Track')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText('What Finish line shows')).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('reports no clip yet before one has landed', async () => {
        renderPanel(CAMERA_ROW);
        await waitFor(() => {
            expect(screen.getByText('No clip yet')).toBeInTheDocument();
        });
    });

    it('shows how long ago the last clip landed', async () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        renderPanel({ ...CAMERA_ROW, lastClipAt: tenSecondsAgo });
        await waitFor(() => {
            expect(screen.getByText(/Last clip 10s ago/)).toBeInTheDocument();
        });
    });

    it('offers no override when the camera already matches the race’s track', async () => {
        renderPanel(CAMERA_ROW, 5);
        await waitFor(() => {
            expect(screen.getByText('Listening to Main Track')).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: "Use this race's track" })).toBeNull();
    });

    it('offers "Use this race\'s track" when the camera is on a different track, and it calls setCameraTrack', async () => {
        renderPanel({ ...CAMERA_ROW, trackId: 11 }, 5);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: "Use this race's track" })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: "Use this race's track" }));
        expect(setCameraTrack).toHaveBeenCalledWith({ displayId: 'c-1', trackId: 5 });
    });

    it('offers no Replays toggle — that rider is meaningless for a camera', async () => {
        renderPanel(CAMERA_ROW);
        await waitFor(() => {
            expect(screen.getByText('Finish line')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText('Whether Finish line plays replays')).toBeNull();
    });
});
