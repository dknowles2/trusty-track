// @vitest-environment jsdom
/**
 * #177 stage 1b — the Displays panel's own camera-role and replays-toggle
 * additions. `DisplaysPanel.test.tsx` covers the pre-existing view/rider
 * controls; this file is scoped to what stage 1b added on top of them.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import { ASSIGN_DISPLAY, SET_CAMERA_TRACK } from '../graphql/queries';
import { GET_TRACKS } from '../../core/graphql/queries';

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

function renderPanel(display: DisplayFixture) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        if (args === GET_TRACKS || (args as { query: unknown })?.query === GET_TRACKS) {
            return [{ data: { tracks: [{ id: 5, name: 'Main Track', timerType: 'FAKE' }] }, fetching: false, error: null }, vi.fn()];
        }
        const queryArg = (args as { query?: { definitions?: { name?: { value?: string } }[] } })?.query;
        const asksForAwards = queryArg?.definitions?.some(
            (definition) => definition.name?.value === 'RaceAwardCount',
        );
        if (asksForAwards) {
            return [{ data: { race: { id: 1, awards: [] } }, fetching: false, error: null }, vi.fn()];
        }
        const asksForTracks = queryArg?.definitions?.some((d) => d.name?.value === 'GetTracks');
        if (asksForTracks) {
            return [{ data: { tracks: [{ id: 5, name: 'Main Track', timerType: 'FAKE' }] }, fetching: false, error: null }, vi.fn()];
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
    trackId: null,
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

    it('offers no track picker on an ordinary display', async () => {
        renderPanel(DISPLAY_ROW);
        await waitFor(() => {
            expect(screen.getByText('Gym north')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText('Which track Gym north listens to')).toBeNull();
    });
});

describe('a CAMERA row', () => {
    it('shows a track picker instead of a view select', async () => {
        renderPanel(CAMERA_ROW);
        await waitFor(() => {
            expect(screen.getByLabelText('Which track Finish line listens to')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText('What Finish line shows')).toBeNull();
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

    it('calls setCameraTrack when a track is picked', async () => {
        renderPanel(CAMERA_ROW);
        await waitFor(() => {
            expect(screen.getByLabelText('Which track Finish line listens to')).toBeInTheDocument();
        });
        fireEvent.change(screen.getByLabelText('Which track Finish line listens to'), {
            target: { value: '5' },
        });
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
