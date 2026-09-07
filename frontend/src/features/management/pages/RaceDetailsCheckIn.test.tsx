// @vitest-environment jsdom
/**
 * #848 — clicking Check In, filling in the weight and pressing "Save
 * Check-in" must actually check the racer in. The dialog's toggle used to
 * seed from the racer's stored state regardless of which button opened it,
 * so an operator working the obvious path (Check In -> type weight -> Save
 * Check-in) never touched the toggle and the racer stayed unchecked.
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

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }),
}));

function mockRaceQuery() {
    (useQuery as any).mockReturnValue([{
        data: {
            race: {
                id: 1,
                name: 'Test Race',
                dateTime: '2024-03-15T10:00:00',
                location: 'Test Location',
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
                trackId: 1,
                organizationId: 1,
                globalStartNumber: 1,
                championshipTrophies: 3,
                weightLimitOz: null,
                track: { name: 'Main Track' },
                racingGroups: [
                    { id: 5, name: 'Wolves', color: '#85c1e9', division: null, carNumberRangeStart: null, carNumberRangeEnd: null },
                ],
                racers: [
                    {
                        id: 9,
                        firstName: 'Jordan',
                        lastName: 'Mitchell',
                        carNumber: 42,
                        racingGroupId: 5,
                        carName: 'Blue Streak',
                        carPassedInspection: false,
                        carWeight: null,
                        racerImageUrl: null,
                        carImageUrl: null,
                        excludedFromStandings: false,
                    },
                ],
                leaderboard: [],
                scheduledRacerIds: [],
                rounds: [],
            },
            tracks: [{ id: 1, name: 'Main Track', laneCount: 4 }],
        },
        fetching: false,
        error: null,
    }, vi.fn()]);
}

describe('the Check In dialog actually checks the racer in (#848)', () => {
    it('checks the racer in when the operator types the weight and presses Save Check-in without touching the toggle', async () => {
        mockRaceQuery();
        const updateRacerMutation = vi.fn().mockResolvedValue({ data: { updateRacer: { id: 9 } } });
        mockMutations([[GQL.UPDATE_RACER, updateRacerMutation]]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getAllByText('Check In').length).toBeGreaterThan(0);
        });
        // The mobile card and the desktop table both render in jsdom, so the
        // same racer's control appears twice — either one opens the
        // identical form.
        await userEvent.click(screen.getAllByText('Check In')[0]);

        await waitFor(() => {
            expect(screen.getAllByLabelText(/Weight \(oz\)/)[0]).toBeInTheDocument();
        });

        const weightInput = screen.getAllByLabelText(/Weight \(oz\)/)[0];
        await userEvent.type(weightInput, '4.9');

        // The obvious path: type the weight, press the dialog's own primary
        // button — never touch the toggle underneath it.
        await userEvent.click(screen.getAllByRole('button', { name: /Save Check-in/ })[0]);

        await waitFor(() => expect(updateRacerMutation).toHaveBeenCalled());
        const variables = updateRacerMutation.mock.calls[0][0];
        expect(variables.id).toBe(9);
        expect(variables.racer.carPassedInspection).toBe(true);
    });
});
