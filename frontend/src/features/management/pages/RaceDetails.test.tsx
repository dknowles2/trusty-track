// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RaceDetails from './RaceDetails';

import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import * as GQL from '../graphql/queries';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

/**
 * Discriminate `useMutation` by document, as `RaceDetailsBulkActions.test.tsx`
 * does. `RaceDetails.tsx` calls `useMutation` ten times; a blanket
 * `mockReturnValue` makes every one of them the same spy, so an assertion on
 * "the mutation" passes whichever button actually fired it. Pass the specific
 * documents a test cares about; every other mutation gets an inert `vi.fn()`.
 */
function mockMutations(overrides: [unknown, ReturnType<typeof vi.fn>][] = []) {
    (useMutation as any).mockImplementation((query: unknown) => {
        const match = overrides.find(([doc]) => doc === query);
        return [{ fetching: false }, match ? match[1] : vi.fn()];
    });
}

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Default no-op subscription mock (overridden in individual tests as needed)
beforeEach(() => {
    (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

const { mockShowAlert, mockShowConfirm } = vi.hoisted(() => {
    return {
        mockShowAlert: vi.fn(),
        mockShowConfirm: vi.fn(),
    }
})

vi.mock('../../../context/AlertContext', () => ({
    useAlert: () => ({
        showAlert: mockShowAlert,
        showConfirm: mockShowConfirm,
    }),
}))

/** Surfaces the current URL's search string so a test can assert on it. */
function LocationSearchProbe() {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
}

describe('RaceDetails', () => {
    describe('opening the edit form directly (#589)', () => {
        // Home's "Edit race" row action and Race Control's own settings link
        // both land on the Roster page with `?edit=true` rather than a
        // `/settings` route of its own — the edit form has always been this
        // page's modal.
        function mockRaceQuery() {
            (useQuery as any).mockReturnValue([{
                data: {
                    race: {
                        id: 1,
                        name: 'Test Race',
                        dateTime: '2024-03-15T10:00:00',
                        location: 'Test Location',
                        schedulingStrategy: 'LANE_ROTATION',
                        scoringStrategy: 'TIMED',
                        carNumberingStrategy: 'PER_GROUP',
                        trackId: 1,
                        organizationId: 1,
                        globalStartNumber: 1,
                        championshipTrophies: 3,
                        track: { name: 'Main Track' },
                        racers: [],
                        racingGroups: [],
                        leaderboard: []
                    },
                    tracks: [{ id: 1, name: 'Main Track' }]
                },
                fetching: false,
                error: null
            }, vi.fn()]);
            mockMutations();
        }

        it('opens the edit modal when the URL asks for it', async () => {
            mockRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1?edit=true']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<><RaceDetails /><LocationSearchProbe /></>} />
                    </Routes>
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('Edit Race Details')).toBeInTheDocument();
            });

            // Stripped rather than left in the URL, or reloading the tab —
            // or coming back to it with the browser's Back button — would
            // reopen a modal nobody asked for this time.
            await waitFor(() => {
                expect(screen.getByTestId('location-search')).toHaveTextContent('');
            });
        });

        it('does not open the edit modal on an ordinary visit', async () => {
            mockRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('Race Settings')).toBeInTheDocument();
            });
            expect(screen.queryByText('Edit Race Details')).not.toBeInTheDocument();
        });
    });

    it('displays human-readable race settings', async () => {
        // Mock race data
        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP',
            organization_id: 1,
            track_id: 1,
            global_start_number: 1,
            championship_trophies: 3
        };

        // Setup mock return values for useQuery
        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    location: mockRace.location,
                    schedulingStrategy: mockRace.scheduling_strategy,
                    scoringStrategy: mockRace.scoring_strategy,
                    carNumberingStrategy: mockRace.car_numbering_strategy,
                    trackId: mockRace.track_id,
                    organizationId: mockRace.organization_id,
                    globalStartNumber: mockRace.global_start_number,
                    championshipTrophies: mockRace.championship_trophies,
                    track: { name: 'Main Track' },
                    racers: [],
                    racingGroups: [],
                    leaderboard: []
                },
                tracks: [{ id: 1, name: 'Main Track' }]
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        mockMutations();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        // Wait for race details to load
        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
        });

        // Verify human-readable settings are displayed
        expect(screen.getByText('Timed (average)')).toBeInTheDocument();
        expect(screen.getByText('Per Den')).toBeInTheDocument();
        expect(screen.getByText('Main Track')).toBeInTheDocument();
    });

    it('filters racers by search term', async () => {
        const mockRacers = [
            { id: 1, first_name: 'John', last_name: 'Doe', car_number: 101, racing_group_id: 1, car_passed_inspection: false },
            { id: 2, first_name: 'Jane', last_name: 'Smith', car_number: 102, racing_group_id: 2, car_passed_inspection: true },
        ];

        const mockRacingGroups = [
            { id: 1, name: 'Tigers', color: 'orange' },
            { id: 2, name: 'Wolves', color: 'red' },
        ];

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: 1,
                    name: 'Test Race',
                    dateTime: '2024-03-15T10:00:00',
                    racers: mockRacers.map(r => ({
                        id: r.id,
                        firstName: r.first_name,
                        lastName: r.last_name,
                        carNumber: r.car_number,
                        carPassedInspection: r.car_passed_inspection,
                        racingGroupId: r.racing_group_id
                    })),
                    racingGroups: mockRacingGroups.map(d => ({ ...d, racerCount: 0 })),
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        mockMutations();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('John')).toBeInTheDocument();
        });

        // Search for "Jane"
        const searchInput = screen.getByPlaceholderText('Search racers...');
        const user = (await import('@testing-library/user-event')).default.setup();
        await user.type(searchInput, 'Jane');

        expect(screen.getByText('Jane')).toBeInTheDocument();
        expect(screen.queryByText('John')).not.toBeInTheDocument();
    });

    it('allows deleting a race', async () => {
        const mockLocation = { href: '' };
        Object.defineProperty(window, 'location', {
            value: mockLocation,
            writable: true
        });

        mockShowConfirm.mockResolvedValue(true);

        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP',
            organization_id: 1,
            global_start_number: 1
        };

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: mockRace.id,
                    name: mockRace.name,
                    dateTime: mockRace.date_time,
                    location: mockRace.location,
                    schedulingStrategy: mockRace.scheduling_strategy,
                    scoringStrategy: mockRace.scoring_strategy,
                    carNumberingStrategy: mockRace.car_numbering_strategy,
                    racers: [],
                    racingGroups: [],
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        const mockDeleteRace = vi.fn().mockResolvedValue({ data: { deleteRace: { success: true } } });
        mockMutations([[GQL.DELETE_RACE, mockDeleteRace]]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
             expect(screen.getByText('Race Settings')).toBeInTheDocument();
             expect(screen.getByText('Edit Details')).toBeInTheDocument();
        });

        const user = (await import('@testing-library/user-event')).default.setup();
        await user.click(screen.getByText('Edit Details'));

        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockDeleteRace).toHaveBeenCalledWith({ id: 1 });
        expect(window.location.href).toBe('/');
    });

    it('calls reexecuteRaceDetails when raceStateChanged subscription fires', async () => {
        const mockReExecute = vi.fn();
        let capturedHandler: ((prev: any, data: any) => any) | undefined;

        (useQuery as any).mockReturnValue([{
            data: {
                race: {
                    id: 1,
                    name: 'Subscription Test Race',
                    dateTime: null,
                    location: '',
                    scoringStrategy: 'TIMED',
                    carNumberingStrategy: 'PER_GROUP',
                    racers: [],
                    racingGroups: [],
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, mockReExecute]);

        mockMutations();

        (useSubscription as any).mockImplementation(
            (_opts: any, handler: (prev: any, data: any) => any) => {
                capturedHandler = handler;
                return [{ data: undefined }, vi.fn()];
            }
        );

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Race Settings')).toBeInTheDocument();
            expect(capturedHandler).toBeDefined();
        });

        act(() => {
            capturedHandler!(undefined, { raceStateChanged: { raceId: 1, changedAt: '2026-01-01T00:00:00Z', kind: 'SCHEDULE' } });
        });

        expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });
});

describe('the fields GetRaceDetails actually asks for', () => {
    /**
     * Field names selected directly on `race` — not inside a nested selection.
     */
    function raceFields(document: { definitions: readonly any[] }): Set<string> {
        const operation = document.definitions[0];
        const race = operation.selectionSet.selections.find(
            (s: any) => s.name.value === 'race',
        );
        return new Set(
            race.selectionSet.selections
                .filter((s: any) => !s.selectionSet)
                .map((s: any) => s.name.value),
        );
    }

    it('asks for trackId, which the settings panel and the edit form both need', async () => {
        // The bug this pins was one missing line in the document, and every
        // test in this file was blind to it: they mock the query result, and a
        // mock is written from what the component reads rather than from what
        // the document selects. So the component read `trackId`, the mocks
        // supplied it, and the server never sent it.
        //
        // Two things followed. The settings panel showed "Track: Unknown" for
        // every race ever created. Worse, opening Edit Details and saving —
        // without touching a field — moved the race to whichever track happened
        // to be first, because `RaceForm` falls back to `tracks[0]` when it has
        // no track. A six-lane race silently became a four-lane one.
        const GQL = await import('../graphql/queries');
        expect(raceFields(GQL.GET_RACE_DETAILS as any)).toContain('trackId');
    });

    it('asks for every scalar the page maps off the race', async () => {
        // Same class, caught generally: anything the mapper reads and the
        // document does not select is `undefined` at runtime and mocked-in at
        // test time.
        const GQL = await import('../graphql/queries');
        const selected = raceFields(GQL.GET_RACE_DETAILS as any);
        for (const field of [
            'id',
            'name',
            'dateTime',
            'location',
            'trackId',
            'scoringStrategy',
            'tiebreaker',
            'carNumberingStrategy',
            'globalStartNumber',
            'championshipTrophies',
        ]) {
            expect(selected).toContain(field);
        }
    });
});

describe('editing a race that is not on the first track', () => {
    it('opens the form on the track the race is actually on', async () => {
        // `RaceForm` defaults a missing track to `tracks[0]`, which is right
        // when creating and destructive when editing: the operator opens the
        // form to change a name and the track field is already wrong.
        const user = userEvent.setup();
        (useQuery as any).mockReturnValue([
            {
                data: {
                    race: {
                        id: 1,
                        name: 'Test Race',
                        dateTime: '2026-03-15T10:00:00',
                        location: 'Gym',
                        trackId: 2,
                        scoringStrategy: 'TIMED',
                        carNumberingStrategy: 'GLOBAL',
                        globalStartNumber: 1,
                        championshipTrophies: 3,
                        racers: [],
                        racingGroups: [],
                        leaderboard: [],
                    },
                    tracks: [
                        { id: 1, name: 'Main Track', laneCount: 4 },
                        { id: 2, name: 'Second Track', laneCount: 6 },
                    ],
                },
                fetching: false,
                error: null,
            },
            vi.fn(),
        ]);
        mockMutations();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => expect(screen.getByText('Race Settings')).toBeInTheDocument());
        // The panel names it too, rather than saying "Unknown".
        expect(screen.getByText('Second Track')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /edit details/i }));

        const trackSelect = await screen.findByLabelText(/track/i);
        expect((trackSelect as HTMLSelectElement).value).toBe('2');
    });
});
