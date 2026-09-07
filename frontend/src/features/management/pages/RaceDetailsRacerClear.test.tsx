// @vitest-environment jsdom
/**
 * The roster's own edit form is what an operator actually uses to clear a
 * racer's den, car number or car name (#747) — a backend that accepts an
 * explicit null is not enough on its own if the screen never sends one.
 * `saveRacer` in `RaceDetails.tsx` is the wiring: blanking a field sends an
 * explicit `null` alongside the matching `clear*` flag, following the same
 * `clearWeightLimit`-shaped pattern `RaceForm`'s own save already uses for
 * the race's own weight limit.
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
                        carPassedInspection: true,
                        carWeight: 5.0,
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

describe('clearing a racer field through the roster edit form (#747)', () => {
    it('sends an explicit null and the matching clear flag for a blanked den, number and name', async () => {
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
            expect(screen.getAllByText(/Checked In \/ Edit/).length).toBeGreaterThan(0);
        });
        // The mobile card and the desktop table both render in jsdom (no
        // real media query breakpoint applies), so the same racer's control
        // appears twice — either one opens the identical form.
        await userEvent.click(screen.getAllByText(/Checked In \/ Edit/)[0]);

        await waitFor(() => {
            expect(screen.getAllByLabelText('Car Number')[0]).toHaveValue(42);
        });

        const carNumberInput = screen.getAllByLabelText('Car Number')[0];
        const carNameInput = screen.getAllByLabelText('Car Name')[0];
        const denSelect = screen.getAllByLabelText('Den')[0];

        await userEvent.clear(carNumberInput);
        await userEvent.clear(carNameInput);
        await userEvent.selectOptions(denSelect, ['']);

        await userEvent.click(screen.getAllByRole('button', { name: /Save Check-in/ })[0]);

        await waitFor(() => expect(updateRacerMutation).toHaveBeenCalled());
        const variables = updateRacerMutation.mock.calls[0][0];
        expect(variables.id).toBe(9);
        expect(variables.racer.carNumber).toBeNull();
        expect(variables.racer.clearCarNumber).toBe(true);
        expect(variables.racer.carName).toBeNull();
        expect(variables.racer.clearCarName).toBe(true);
        expect(variables.racer.racingGroupId).toBeNull();
        expect(variables.racer.clearRacingGroup).toBe(true);
        // A field that was not touched must not be sent as a clear.
        expect(variables.racer.clearCarWeight).toBe(false);
        expect(variables.racer.carWeight).toBe(5);
    });
});
