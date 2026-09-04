// @vitest-environment jsdom
/**
 * A locked race, on the roster page (#585): the badge and notice show, the
 * mutating toolbar controls are disabled, and deleting it goes through the
 * type-the-name confirmation rather than the ordinary yes/no one. Backend
 * enforcement is `backend/tests/test_race_lock.py`'s job; this is only what
 * the screen itself does.
 */
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import * as GQL from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

function mockMutations(overrides: [unknown, ReturnType<typeof vi.fn>][] = []) {
    (useMutation as any).mockImplementation((query: unknown) => {
        const match = overrides.find(([doc]) => doc === query);
        return [{ fetching: false }, match ? match[1] : vi.fn()];
    });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

const { mockShowAlert, mockShowConfirm } = vi.hoisted(() => ({
    mockShowAlert: vi.fn(),
    mockShowConfirm: vi.fn(),
}));

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showConfirm: mockShowConfirm,
    }),
}));

function mockLockedRaceQuery(isLocked: boolean) {
    (useQuery as any).mockReturnValue([{
        data: {
            race: {
                id: 1,
                name: 'Concluded Derby',
                dateTime: null,
                location: null,
                trackId: 1,
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
                racers: [],
                racingGroups: [],
                leaderboard: [],
                isLocked,
            },
            tracks: [{ id: 1, name: 'Main Track' }],
        },
        fetching: false,
        error: null,
    }, vi.fn()]);
}

function renderRaceDetails() {
    return render(
        <MemoryRouter initialEntries={['/races/1']}>
            <Routes>
                <Route path="/races/:raceId" element={<RaceDetails />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('a locked race on the roster page', () => {
    it('shows the Locked badge and notice', async () => {
        mockLockedRaceQuery(true);
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        expect(screen.getByText('Locked')).toBeInTheDocument();
        expect(screen.getByTestId('race-locked-notice')).toHaveTextContent(
            'This race is locked. Unlock it from Edit race to make changes.',
        );
    });

    it('shows no badge or notice for an unlocked race', async () => {
        mockLockedRaceQuery(false);
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        expect(screen.queryByText('Locked')).not.toBeInTheDocument();
        expect(screen.queryByTestId('race-locked-notice')).not.toBeInTheDocument();
    });

    it('disables Add Racer', async () => {
        mockLockedRaceQuery(true);
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /Add Racer/ })).toBeDisabled();
    });

    it('does not disable Add Racer for an unlocked race', async () => {
        mockLockedRaceQuery(false);
        mockMutations();

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /Add Racer/ })).toBeEnabled();
    });

    it('deleting goes through the type-the-name confirmation, not the ordinary one', async () => {
        mockLockedRaceQuery(true);
        const mockDeleteRace = vi.fn().mockResolvedValue({ data: { deleteRace: true } });
        mockMutations([[GQL.DELETE_RACE, mockDeleteRace]]);

        renderRaceDetails();

        await waitFor(() => {
            expect(screen.getByText('Edit Details')).toBeInTheDocument();
        });

        const user = userEvent.setup();
        await user.click(screen.getByText('Edit Details'));

        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        // The ordinary confirm never fires for a locked race.
        expect(mockShowConfirm).not.toHaveBeenCalled();
        // Instead, the name-confirmation modal is open and the delete
        // mutation has not run yet.
        expect(await screen.findByText('Delete locked race')).toBeInTheDocument();
        expect(mockDeleteRace).not.toHaveBeenCalled();

        await user.type(
            screen.getByLabelText('Type the race name to confirm deletion'),
            'Concluded Derby',
        );
        await user.click(screen.getByRole('button', { name: 'Delete race' }));

        expect(mockDeleteRace).toHaveBeenCalledWith({ id: 1 });
    });
});
