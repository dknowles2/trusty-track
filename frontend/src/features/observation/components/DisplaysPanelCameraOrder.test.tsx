// @vitest-environment jsdom
/**
 * The Displays panel's own camera-order control (#177 stage 4) — see
 * `DisplaysPanelCamera.test.tsx` for stage 1b's own role/track-picker/
 * replays-toggle coverage, which this file does not repeat. Multiple
 * camera rows are needed here, unlike that file's single-fixture
 * `renderPanel`, so this is its own small harness rather than an addition
 * to that one.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DisplaysPanel from './DisplaysPanel';
import { useQuery, useMutation, useClient } from 'urql';
import { SET_CAMERA_ORDER } from '../graphql/queries';
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

interface DisplayFixture {
    displayId: string;
    name: string;
    role: 'DISPLAY' | 'CAMERA';
    view: string;
    replays: boolean;
    trackId: number | null;
    lastClipAt: string | null;
    cameraOrder: number;
    connected: boolean;
}

const setCameraOrder = vi.fn().mockResolvedValue({ data: {} });

function camera(displayId: string, name: string, cameraOrder: number): DisplayFixture {
    return {
        displayId,
        name,
        role: 'CAMERA',
        view: 'STANDINGS',
        replays: true,
        trackId: null,
        lastClipAt: null,
        cameraOrder,
        connected: true,
    };
}

function renderPanel(displays: DisplayFixture[]) {
    (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockImplementation((args: unknown) => {
        const queryArg = (args as { query?: { definitions?: { name?: { value?: string } }[] } })?.query;
        if (args === GET_TRACKS || queryArg?.definitions?.some((d) => d.name?.value === 'GetTracks')) {
            return [{ data: { tracks: [] }, fetching: false, error: null }, vi.fn()];
        }
        if (queryArg?.definitions?.some((d) => d.name?.value === 'RaceAwardCount')) {
            return [{ data: { race: { id: 1, awards: [] } }, fetching: false, error: null }, vi.fn()];
        }
        return [{ data: { displays }, fetching: false, error: null }, vi.fn()];
    });

    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
        if (query === SET_CAMERA_ORDER) return [{ fetching: false }, setCameraOrder];
        return [{ fetching: false }, vi.fn()];
    });
    (vi.mocked(useClient) as ReturnType<typeof vi.fn>).mockReturnValue({ query: vi.fn() });

    render(<DisplaysPanel raceId={1} />);
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('camera order (#177 stage 4)', () => {
    it('offers no ↑/↓ with only one camera — nothing to order it against', async () => {
        renderPanel([camera('c-1', 'Finish line', 0)]);
        await waitFor(() => {
            expect(screen.getByText('Finish line')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText("Play Finish line's clip earlier")).toBeNull();
    });

    it('disables ↑ on the first camera and ↓ on the last', async () => {
        renderPanel([camera('c-1', 'Finish line', 0), camera('c-2', 'Side angle', 1)]);
        await waitFor(() => {
            expect(screen.getByLabelText("Play Finish line's clip earlier")).toBeInTheDocument();
        });

        expect(screen.getByLabelText("Play Finish line's clip earlier")).toBeDisabled();
        expect(screen.getByLabelText("Play Finish line's clip later")).not.toBeDisabled();
        expect(screen.getByLabelText("Play Side angle's clip earlier")).not.toBeDisabled();
        expect(screen.getByLabelText("Play Side angle's clip later")).toBeDisabled();
    });

    it('moving the second camera up swaps both cameras to a fresh 0/1 order', async () => {
        const user = userEvent.setup();
        renderPanel([camera('c-1', 'Finish line', 0), camera('c-2', 'Side angle', 1)]);
        await waitFor(() => {
            expect(screen.getByLabelText("Play Side angle's clip earlier")).toBeInTheDocument();
        });

        await user.click(screen.getByLabelText("Play Side angle's clip earlier"));

        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-2', order: 0 });
        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-1', order: 1 });
    });

    it('moving the first camera down produces the identical swap', async () => {
        const user = userEvent.setup();
        renderPanel([camera('c-1', 'Finish line', 0), camera('c-2', 'Side angle', 1)]);
        await waitFor(() => {
            expect(screen.getByLabelText("Play Finish line's clip later")).toBeInTheDocument();
        });

        await user.click(screen.getByLabelText("Play Finish line's clip later"));

        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-2', order: 0 });
        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-1', order: 1 });
    });

    it('establishes a real order on the very first press even when every camera is tied at 0', async () => {
        const user = userEvent.setup();
        renderPanel([camera('c-1', 'Alpha', 0), camera('c-2', 'Bravo', 0), camera('c-3', 'Charlie', 0)]);
        await waitFor(() => {
            expect(screen.getByLabelText("Play Bravo's clip earlier")).toBeInTheDocument();
        });

        // Both untouched neighbours tie at cameraOrder 0 and sort by
        // displayId — Alpha, Bravo, Charlie. Moving Bravo up reorders to
        // Bravo, Alpha, Charlie and reassigns 0/1/2 across that: Bravo's
        // own index (0) matches the value it already had, so *it* is the
        // one row not called — Alpha and Charlie both move off their tied
        // `0` and are.
        await user.click(screen.getByLabelText("Play Bravo's clip earlier"));

        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-1', order: 1 });
        expect(setCameraOrder).toHaveBeenCalledWith({ displayId: 'c-3', order: 2 });
        expect(setCameraOrder).not.toHaveBeenCalledWith({ displayId: 'c-2', order: expect.anything() });
    });
});
