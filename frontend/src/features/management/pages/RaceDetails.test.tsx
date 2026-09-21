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

/**
 * Stands in for the real `SetupChecklist` so a test can fire any `onAction`
 * handler directly — `checklistFor`'s own gating (`setupChecklist.test.ts`)
 * means a step's handler is only reachable through the real component once a
 * specific, sometimes unreachable-in-practice combination of progress values
 * lines up (the printables step, for one, becomes done at the same instant
 * checkin does — see `setupChecklist.ts`). What this file is testing is the
 * *wiring* — which URL a given step's handler navigates to — not whether the
 * checklist chooses to show it as "next" today.
 */
vi.mock('../components/SetupChecklist', () => ({
    default: ({ onAction }: { onAction: Record<string, (() => void) | undefined> }) => (
        <div data-testid="setup-checklist-stub">
            {Object.entries(onAction).map(([key, handler]) => (
                <button
                    key={key}
                    data-testid={`checklist-action-${key}`}
                    onClick={handler}
                >
                    {key}
                </button>
            ))}
        </div>
    ),
}));

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

        it('opens the edit modal on the named section (#970)', async () => {
            mockRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1?edit=true&section=scoring']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<><RaceDetails /><LocationSearchProbe /></>} />
                    </Routes>
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByTestId('race-settings-nav-scoring')).toHaveAttribute('aria-current', 'page');
            });

            // Both params are stripped together, the same as `edit` alone —
            // a stale `section` left in the URL after the modal closes would
            // mean nothing today, but leaving half a pair behind is how a
            // future reader assumes the other half is still doing something.
            await waitFor(() => {
                expect(screen.getByTestId('location-search')).toHaveTextContent('');
            });
        });

        it('falls back to Event for an unrecognised section', async () => {
            mockRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1?edit=true&section=nonsense']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByTestId('race-settings-nav-event')).toHaveAttribute('aria-current', 'page');
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
                expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
            });
            expect(screen.queryByText('Edit Race Details')).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------
    // Phone chrome: Edit race moves into the roster's own overflow (#1148)
    // -----------------------------------------------------------------
    //
    // Under 768px the standalone header row (the race's own name plus the
    // Edit race pill) is dropped, and the same action is reachable from the
    // roster toolbar's ⋯ overflow instead — it must still open the
    // identical modal, not a new route.
    describe('the mobile roster overflow (#1148)', () => {
        function resizeTo(width: number) {
            Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
            window.dispatchEvent(new Event('resize'));
        }

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

        afterEach(() => {
            resizeTo(1024);
        });

        it('offers Edit race from the roster overflow and opens the same modal', async () => {
            resizeTo(390);
            mockRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            );

            // No standalone pill at phone width.
            expect(screen.queryByTestId('edit-race-btn')).not.toBeInTheDocument();

            const moreMenu = await screen.findByTestId('roster-more-menu');
            await userEvent.click(moreMenu);

            const editButton = await screen.findByTestId('edit-race-btn');
            await userEvent.click(editButton);

            await waitFor(() => {
                expect(screen.getByText('Edit Race Details')).toBeInTheDocument();
            });
        });
    });

    describe('the shared race-view heading (#1296, #1297)', () => {
        function mockRaceQuery(overrides: Record<string, unknown> = {}) {
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
                        leaderboard: [],
                        isLocked: false,
                        ...overrides,
                    },
                    tracks: [{ id: 1, name: 'Main Track' }]
                },
                fetching: false,
                error: null
            }, vi.fn()]);
            mockMutations();
        }

        it('shows the race name and the Locked badge when the race is locked', async () => {
            mockRaceQuery({ isLocked: true });

            render(
                <MemoryRouter initialEntries={['/race/1']}>
                    <Routes>
                        <Route path="/race/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            );

            const heading = await screen.findByTestId('roster-heading');
            expect(heading).toHaveTextContent('Test Race');
            expect(heading).toHaveTextContent('Locked');
        });

        it('shows no Locked badge when the race is not locked', async () => {
            mockRaceQuery({ isLocked: false });

            render(
                <MemoryRouter initialEntries={['/race/1']}>
                    <Routes>
                        <Route path="/race/:raceId" element={<RaceDetails />} />
                    </Routes>
                </MemoryRouter>
            );

            const heading = await screen.findByTestId('roster-heading');
            expect(heading).not.toHaveTextContent('Locked');
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
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        // Verify the human-readable settings summary line, now one muted
        // line under the page heading rather than a four-cell grid (#949).
        expect(screen.getByTestId('race-summary-line')).toHaveTextContent(
            'Timed (average) · Per Den · 3 trophies · Main Track',
        );
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
             expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
             expect(screen.getByText('Edit race')).toBeInTheDocument();
        });

        const user = (await import('@testing-library/user-event')).default.setup();
        await user.click(screen.getByText('Edit race'));

        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        expect(mockShowConfirm).toHaveBeenCalled();
        expect(mockDeleteRace).toHaveBeenCalledWith({ id: 1 });
        expect(window.location.href).toBe('/');
    });

    // #1101 — performDeleteRace used to swallow whatever the server said
    // into a fixed "Failed to delete race", the one remaining fixed-string
    // catch on this page after #1100's sweep. A locked race's own refusal
    // (`RaceLockExtension`) is the natural case to reach it with: the
    // operator needs the sentence to know the fix is "unlock the race",
    // not "try again".
    it('shows the server\'s own reason a delete was refused, not a fixed string', async () => {
        mockShowConfirm.mockResolvedValue(true);

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
                    racers: [],
                    racingGroups: [],
                    leaderboard: []
                },
                tracks: []
            },
            fetching: false,
            error: null
        }, vi.fn()]);

        const mockDeleteRace = vi.fn().mockResolvedValue({
            error: {
                graphQLErrors: [
                    { message: 'This race is locked. Unlock it from Edit race to make changes.' },
                ],
            },
        });
        mockMutations([[GQL.DELETE_RACE, mockDeleteRace]]);

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
             expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
             expect(screen.getByText('Edit race')).toBeInTheDocument();
        });

        const user = (await import('@testing-library/user-event')).default.setup();
        await user.click(screen.getByText('Edit race'));

        const deleteBtn = await screen.findByText('Delete Race');
        await user.click(deleteBtn);

        await waitFor(() => {
            expect(mockShowAlert).toHaveBeenCalledWith(
                'This race is locked. Unlock it from Edit race to make changes.',
                'Error',
            );
        });
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
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
            expect(capturedHandler).toBeDefined();
        });

        act(() => {
            capturedHandler!(undefined, { raceStateChanged: { raceId: 1, changedAt: '2026-01-01T00:00:00Z', kind: 'SCHEDULE' } });
        });

        expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });
});

describe('the Add Racer menu (#1086)', () => {
    // #1086 collapsed the GPRM and DerbyNet entries, each opening its own
    // mount of `RosterImportModal`, into one entry that opens the modal
    // without a `source` -- the modal asks which program on its own chooser
    // step. This pins the menu itself: exactly three entries, not four, and
    // no more "GrandPrix Race Manager" / "DerbyNet" split in the menu text.
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

    it('lists CSV, other racing software, and Populate Test Data -- nothing else', async () => {
        mockRaceQuery();

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('race-summary-line')).toBeInTheDocument();
        });

        await userEvent.click(screen.getByRole('button', { name: 'More ways to add racers' }));

        const menu = screen.getByText('Import from CSV').closest('.dropdown-content') as HTMLElement;
        expect(menu).not.toBeNull();
        const entries = Array.from(menu.querySelectorAll('button')).map((button) => button.textContent?.trim());

        expect(entries).toEqual([
            'Populate Test Data',
            'Import from CSV',
            'Import from other racing software',
        ]);
        expect(screen.queryByText(/Import from GrandPrix Race Manager/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Import from DerbyNet/)).not.toBeInTheDocument();
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
        // every race ever created. Worse, opening Edit race and saving —
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

        await waitFor(() => expect(screen.getByTestId('race-summary-line')).toBeInTheDocument());
        // The summary line names it too, rather than saying "Unknown".
        expect(screen.getByTestId('race-summary-line')).toHaveTextContent('Second Track');

        await user.click(screen.getByRole('button', { name: /edit race/i }));

        // Exact text, not the loose /track/i this used to be: the Event
        // section's Lock race box now carries a DocsLink whose title is
        // "Race and track settings" (#1194's `lock-race` docs entry), and a
        // fuzzy regex matches that too — "Found multiple elements" — so this
        // has to name the field's own label precisely.
        const trackSelect = await screen.findByLabelText('Track / Timer');
        expect((trackSelect as HTMLSelectElement).value).toBe('2');
    });

    describe('printing (#957)', () => {
        function mockPrintableRaceQuery() {
            (useQuery as any).mockReturnValue([
                {
                    data: {
                        race: {
                            id: 1,
                            name: 'Print Hub Race',
                            dateTime: '2024-03-15T10:00:00',
                            location: 'Test Location',
                            schedulingStrategy: 'LANE_ROTATION',
                            scoringStrategy: 'TIMED',
                            carNumberingStrategy: 'PER_GROUP',
                            trackId: 1,
                            organizationId: 1,
                            globalStartNumber: 1,
                            championshipTrophies: 3,
                            registeredCount: 0,
                            checkedInCount: 0,
                            isLocked: false,
                            track: { name: 'Main Track' },
                            racers: [],
                            racingGroups: [],
                            rounds: [],
                            awards: [],
                            leaderboard: [],
                        },
                        tracks: [{ id: 1, name: 'Main Track' }],
                    },
                    fetching: false,
                    error: null,
                },
                vi.fn(),
            ]);
            mockMutations();
        }

        it('renames the roster overflow entry to "Print…" (#957)', async () => {
            const user = userEvent.setup();
            mockPrintableRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                        <Route path="/race/:raceId/print" element={<LocationSearchProbe />} />
                    </Routes>
                </MemoryRouter>,
            );

            await waitFor(() => expect(screen.getByTestId('race-summary-line')).toBeInTheDocument());

            await user.click(screen.getByTestId('roster-more-menu'));
            const printEntry = screen.getByRole('button', { name: /^Print…/ });
            expect(printEntry).toBeInTheDocument();

            await user.click(printEntry);
            expect(await screen.findByTestId('location-search')).toBeInTheDocument();
        });

        it('sends the setup checklist\'s printables step to the hub with pit passes preselected (#957)', async () => {
            // `SetupChecklist` is stubbed above so this exercises the
            // `onAction.printables` wiring directly, independent of
            // whether `checklistFor` currently offers that step as "next"
            // (`setupChecklist.ts` — it never does once check-in has
            // started, and never before, by construction).
            const user = userEvent.setup();
            mockPrintableRaceQuery();

            render(
                <MemoryRouter initialEntries={['/races/1']}>
                    <Routes>
                        <Route path="/races/:raceId" element={<RaceDetails />} />
                        <Route
                            path="/race/:raceId/print"
                            element={<LocationSearchProbe />}
                        />
                    </Routes>
                </MemoryRouter>,
            );

            await waitFor(() => expect(screen.getByTestId('race-summary-line')).toBeInTheDocument());

            await user.click(screen.getByTestId('checklist-action-printables'));

            expect(await screen.findByTestId('location-search')).toHaveTextContent('?kind=pit-pass');
        });
    });
});
