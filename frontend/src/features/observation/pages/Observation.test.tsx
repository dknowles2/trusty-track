// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import Observation from './Observation';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import {
    LeaderboardSubscription,
    OnDeckSubscription,
    CurrentlyRacingSubscription,
    TimingStatsSubscription,
    ActiveFreeRaceHeatSubscription,
    DisplayAssignmentSubscription
} from '../graphql/queries';
import { TIMER_STATUS_SUBSCRIPTION } from '../../racing/graphql/queries';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Observation Page', () => {
    const mockRacersData = {
        race: {
            id: 1,
            racers: [
                { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null },
                { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: null },
                { id: 3, firstName: 'Mater', lastName: 'Tow', carNumber: 1, racerImageUrl: null },
            ],
        }
    };

    const setupMocks = (overrides: any = {}, racersData: any = mockRacersData) => {
        (useQuery as any).mockReturnValue([{ data: racersData, fetching: false, error: null }]);

        const defaultSubs = {
            leaderboard: [],
            onDeck: [],
            currentlyRacing: null,
            timingStats: null,
            activeFreeRaceHeat: null,
            // Which heat the timer is armed for. `null` is "nothing armed",
            // which is what makes a free race an exhibition only when it is
            // actually on the track (#142).
            armedHeatId: null,
            // What this screen has been told, including its own name and the
            // identify counter (#495). `null` is "no payload yet", which is
            // what most tests below the naming ones want.
            displayAssignment: null,
            ...overrides
        };

        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: defaultSubs.leaderboard } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: defaultSubs.onDeck } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: defaultSubs.currentlyRacing } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats: defaultSubs.timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: defaultSubs.activeFreeRaceHeat } }];
            if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: defaultSubs.armedHeatId } } } }];
            if (query === DisplayAssignmentSubscription) return [{ data: { displayAssignment: defaultSubs.displayAssignment } }];
            return [{ data: null }];
        });
    };

    it('displays Now Racing and On Deck heats correctly', async () => {
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 2, placeholderSlot: null }],
            },
            onDeck: [{
                id: 3, roundNumber: 1, heatNumber: 3,
                lanes: [{ lane: 1, racerId: 3, placeholderSlot: null }],
            }]
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
            expect(screen.getByText('(Round 1, Heat 2)')).toBeInTheDocument();
            expect(screen.getByText('On Deck')).toBeInTheDocument();
        });

        expect(screen.getAllByText('Doc Hudson').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mater Tow').length).toBeGreaterThan(0);
    });

    it('shows a second heat so cars can be staged a heat early (#209)', async () => {
        // The child named on screen is in the bleachers rather than watching
        // it, so a display that names only the next heat names them at the
        // moment the announcer is already calling for them.
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 1, placeholderSlot: null }],
            },
            onDeck: [
                {
                    id: 3, roundNumber: 1, heatNumber: 3,
                    lanes: [{ lane: 1, racerId: 2, placeholderSlot: null }],
                },
                {
                    id: 4, roundNumber: 1, heatNumber: 4,
                    lanes: [{ lane: 1, racerId: 3, placeholderSlot: null }],
                },
            ],
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('On Deck')).toBeInTheDocument();
        });
        expect(screen.getByText('After That')).toBeInTheDocument();
        expect(screen.getByText('(Round 1, Heat 4)')).toBeInTheDocument();
    });

    it('leaves the second card off when there is no heat after next', async () => {
        // The last two heats of a race, where an empty card on the wall would
        // read as something being broken.
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 1, placeholderSlot: null }],
            },
            onDeck: [
                {
                    id: 3, roundNumber: 1, heatNumber: 3,
                    lanes: [{ lane: 1, racerId: 2, placeholderSlot: null }],
                },
            ],
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('On Deck')).toBeInTheDocument();
        });
        expect(screen.queryByText('After That')).not.toBeInTheDocument();
    });

    it('names the lane a car is really in, not its position in the list', async () => {
        // #141. Lane 2 is vacant — a racer deleted after the schedule was
        // generated, or a championship slot nobody has qualified for yet. The
        // car in lane 3 must still be announced as lane 3; numbering the
        // survivors 1, 2, 3… told the audience the wrong lane for every car
        // after the gap, on the screen they are watching.
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [
                    { lane: 1, racerId: 2, placeholderSlot: null },
                    { lane: 2, racerId: null, placeholderSlot: null },
                    { lane: 3, racerId: 3, placeholderSlot: null },
                ],
            },
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
        });

        expect(screen.getByText('Lane 1')).toBeInTheDocument();
        expect(screen.getByText('Lane 3')).toBeInTheDocument();
        // The empty lane has nobody to show, so it is not on screen at all —
        // but it must not hand its number to the car behind it.
        expect(screen.queryByText('Lane 2')).not.toBeInTheDocument();
    });

    it('handles case with no upcoming heats', async () => {
        setupMocks();

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
            expect(screen.getAllByText('No heat scheduled')).toHaveLength(2);
        });
    });

    it('shows a free race in Now Racing while the timer is armed for it', async () => {
        setupMocks({
            activeFreeRaceHeat: {
                id: 99,
                lanes: [{ lane: 1, racerId: 1 }],
            },
            armedHeatId: 99,
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
            expect(screen.getByText('Exhibition')).toBeInTheDocument();
            expect(screen.getAllByText('Speedy McQueen').length).toBeGreaterThan(0);
        });
    });

    it('shows a free race even while official heats are still to run', async () => {
        // #142. `currentlyRacing` returns the first *unfinished* official heat,
        // so it is truthy for the whole event — and the old rule
        // (`!officialCurrentHeat && activeFreeRace`) therefore never fired
        // while a race was on. A demonstration run for a scout whose car broke
        // reached the wall before the schedule existed, or after the trophies,
        // and at no point in between.
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 2, placeholderSlot: null }],
            },
            activeFreeRaceHeat: {
                id: 99,
                lanes: [{ lane: 1, racerId: 1 }],
            },
            armedHeatId: 99,
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Exhibition')).toBeInTheDocument();
        });
        // The exhibition's racer, not the scheduled heat's.
        expect(screen.getAllByText('Speedy McQueen').length).toBeGreaterThan(0);
        expect(screen.queryByText('(Round 1, Heat 2)')).not.toBeInTheDocument();
    });

    it('a free race the timer is not armed for does not displace the scheduled heat', async () => {
        // A free heat created and then abandoned stays "active" until it is run
        // or deleted. It is not on the track just because nobody tidied it up.
        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 2, placeholderSlot: null }],
            },
            activeFreeRaceHeat: {
                id: 99,
                lanes: [{ lane: 1, racerId: 1 }],
            },
            armedHeatId: null,
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('(Round 1, Heat 2)')).toBeInTheDocument();
            expect(screen.queryByText('Exhibition')).not.toBeInTheDocument();
            expect(screen.getAllByText('Doc Hudson').length).toBeGreaterThan(0);
        });
    });

    it('displays Timing Stats correctly', async () => {
        setupMocks({
            timingStats: {
                heatId: 1,
                roundName: 'Round 1',
                heatNumber: 1,
                lanes: [
                    { laneNumber: 1, racerName: 'Speedy McQueen', carName: '95', time: 3.5, place: 1 }
                ]
            }
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        // Switch to Timing Stats tab
        const timingTab = screen.getByText('Timing Stats');
        timingTab.click();

        await waitFor(() => {
            expect(screen.getByText('Last Completed: Round 1 / Heat 1')).toBeInTheDocument();
            expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();
            expect(screen.getByText('3.500s')).toBeInTheDocument();
        });
    });

    it('renders the timing rows with Display tokens, not App tokens (#527)', async () => {
        // #527: these rows used to read --surface-color / --text-color /
        // --text-muted-color / --border-color, which inherit from the
        // *viewing device's own* App theme rather than the organisation's
        // Display theme — white-on-white once the old .projector-mode
        // !important overrides masking it stopped matching. A second-place
        // lane exercises the non-gold-highlight background branch.
        setupMocks({
            timingStats: {
                heatId: 1,
                roundName: 'Round 1',
                heatNumber: 1,
                lanes: [
                    { laneNumber: 1, racerName: 'Speedy McQueen', carName: '95', time: 3.5, place: 2 },
                ],
            },
        });

        const { container } = render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        const timingTab = screen.getByText('Timing Stats');
        timingTab.click();

        await waitFor(() => {
            expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();
        });

        const row = container.querySelector('.timing-list-item') as HTMLElement;
        const racerName = container.querySelector('.timing-racer-name') as HTMLElement;
        const carName = container.querySelector('.timing-car-name') as HTMLElement;
        expect(row).toBeTruthy();
        expect(row.getAttribute('style')).toMatch(/var\(--display-card-bg-color\)/);
        expect(row.getAttribute('style')).toMatch(/var\(--display-border-color\)/);
        expect(row.getAttribute('style')).not.toMatch(/var\(--surface-tint-color/);
        expect(row.getAttribute('style')).not.toMatch(/var\(--border-color\)/);
        expect(carName.getAttribute('style')).toMatch(/var\(--display-text-muted-color\)/);
        expect(carName.getAttribute('style')).not.toMatch(/var\(--text-muted-color\)/);
        // Ancestors set --display-text-color rather than --text-color, so the
        // rank/name inherit the right colour instead of the viewing device's
        // own App theme.
        expect(racerName.closest('.timing-list-wrapper')?.getAttribute('style')).toMatch(
            /var\(--display-surface-color\)/,
        );
    });

    it('renders in Projector Mode correctly', async () => {
        setupMocks({
            leaderboard: [
                { racerId: 1, score: 3.2, heatsCompleted: 2, rank: 1 }
            ]
        });

        render(
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText(/Current Standings/)).toBeInTheDocument();
            // In projector mode, buttons and tabs are hidden
            expect(screen.queryByText('Launch Projector Mode')).not.toBeInTheDocument();
            // Table should be visible
            expect(screen.getByText('Speedy')).toBeInTheDocument();
            expect(screen.getByText('McQueen')).toBeInTheDocument();
        });

        // The container should have the projector-mode class
        const container = screen.getByText(/Now Racing/).closest('.container');
        expect(container).toHaveClass('projector-mode');
    });

    it('labels a POINTS race by points rather than seconds, and keeps the shared rank instead of renumbering it (#329)', async () => {
        const racersData = {
            race: {
                id: 1,
                scoringStrategy: 'POINTS',
                racers: [
                    { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null },
                    { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: null },
                    { id: 3, firstName: 'Mater', lastName: 'Tow', carNumber: 1, racerImageUrl: null },
                ],
            }
        };

        setupMocks({
            leaderboard: [
                // #226: two racers tied for first share rank 1; Mater is 3rd,
                // not 2nd — the audience display must not renumber them.
                { racerId: 1, score: 12, heatsCompleted: 4, rank: 1 },
                { racerId: 2, score: 12, heatsCompleted: 4, rank: 1 },
                { racerId: 3, score: 20, heatsCompleted: 4, rank: 3 },
            ],
        }, racersData);

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Points')).toBeInTheDocument();
        });

        // A POINTS total is not a time — the header must not still say
        // "Avg Time", and the score must not carry a fabricated "s" suffix.
        expect(screen.queryByText('Avg Time')).not.toBeInTheDocument();
        expect(screen.queryByText('12.0000s')).not.toBeInTheDocument();
        expect(screen.getAllByText('12').length).toBe(2);
        expect(screen.getByText('20')).toBeInTheDocument();

        const mcqueenRow = screen.getByText('Speedy McQueen').closest('tr');
        const docRow = screen.getByText('Doc Hudson').closest('tr');
        const materRow = screen.getByText('Mater Tow').closest('tr');
        expect(mcqueenRow?.querySelector('.standing-rank')?.textContent).toBe('1');
        expect(docRow?.querySelector('.standing-rank')?.textContent).toBe('1');
        expect(materRow?.querySelector('.standing-rank')?.textContent).toBe('3');
    });

    it('projector standings label a POINTS race by points and keep the shared rank (#329)', async () => {
        const racersData = {
            race: {
                id: 1,
                scoringStrategy: 'POINTS',
                racers: [
                    { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null },
                    { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: null },
                ],
            }
        };

        setupMocks({
            leaderboard: [
                { racerId: 1, score: 12, heatsCompleted: 4, rank: 1 },
                { racerId: 2, score: 12, heatsCompleted: 4, rank: 1 },
            ],
        }, racersData);

        render(
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getAllByText('Points').length).toBeGreaterThan(0);
        });

        expect(screen.queryByText('Avg Time')).not.toBeInTheDocument();
        expect(screen.getAllByText('12').length).toBe(2);

        // Both racers tied for first — neither is renumbered to 2nd.
        const rankCells = document.querySelectorAll('.projector-standings-rank-col');
        expect(Array.from(rankCells).map((el) => el.textContent)).toEqual(['1', '1']);
    });

    it("shows a racer's racingGroup category as a label when their racingGroup has one (#298, #496 stage 2)", async () => {
        const racersWithRacingGroups = {
            race: {
                id: 1,
                racers: [
                    { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null, racingGroupId: 1 },
                    { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: null, racingGroupId: 2 },
                    { id: 3, firstName: 'Mater', lastName: 'Tow', carNumber: 1, racerImageUrl: null, racingGroupId: null },
                ],
                racingGroups: [
                    { id: 1, name: 'Wolves', color: '#000', division: 'Wolf' },
                    { id: 2, name: 'Unassigned', color: '#111', division: null },
                ],
            }
        };

        setupMocks({
            currentlyRacing: {
                id: 2, roundNumber: 1, heatNumber: 2,
                lanes: [{ lane: 1, racerId: 1, placeholderSlot: null }],
            },
            leaderboard: [
                { racerId: 1, score: 3.2, heatsCompleted: 2, rank: 1, racingGroupDivision: 'Wolf' },
                { racerId: 2, score: 3.5, heatsCompleted: 2, rank: 2, racingGroupDivision: null },
            ],
        }, racersWithRacingGroups);

        render(
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
        });

        // The racer in "Now Racing" is in the Wolves racingGroup, which has a category —
        // shown on the heat card, and again on the live standings below it.
        expect(screen.getAllByText('Wolf').length).toBeGreaterThan(0);
        // Doc's racingGroup has no category, so his standings row names none.
        const docRow = screen.getByText('Doc Hudson').closest('tr');
        expect(docRow?.textContent).not.toMatch(/Wolf/);
    });

    it('does not flash the overlay for the subscription\'s opening payload (#335)', async () => {
        // A projector that just loaded (or reconnected) receives an opening
        // snapshot for whatever heat finished last — possibly minutes ago.
        // That is history, not news, and must not pop the overlay.
        const timingStats = {
            heatId: 1,
            recordedAt: '2026-01-01T00:00:00Z',
            roundName: 'Round 1',
            heatNumber: 1,
            lanes: [
                { laneNumber: 1, racerName: 'Speedy McQueen', carName: '95', time: 3.5, place: 1, racerImageUrl: 'http://example.com/speedy.jpg' },
            ]
        };

        setupMocks({ timingStats });

        render(
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
        });

        expect(screen.queryByText('Heat Results')).not.toBeInTheDocument();
    });

    it('shows the overlay for a heat that finishes after the page has loaded, and re-shows it when the same heat is re-recorded', async () => {
        let timingStats: any = {
            heatId: 1,
            recordedAt: '2026-01-01T00:00:00Z',
            roundName: 'Round 1',
            heatNumber: 1,
            lanes: [
                { laneNumber: 1, racerName: 'Speedy McQueen', carName: '95', time: 3.5, place: 1, racerImageUrl: 'http://example.com/speedy.jpg' },
                { laneNumber: 2, racerName: 'Doc Hudson', carName: '51', time: 3.6, place: 2, racerImageUrl: null },
            ]
        };

        (useQuery as any).mockReturnValue([{ data: mockRacersData, fetching: false, error: null }]);
        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: [] } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: [] } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: null } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: null } }];
            if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: null } } } }];
            return [{ data: null }];
        });

        vi.useFakeTimers();

        // A fresh element on every call — reusing one const across `rerender`
        // calls makes React bail out at the root (identical props, no local
        // state change on that fiber) without ever calling `Observation`
        // again, silently defeating the mock update below it.
        const renderTree = () => (
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );
        const { rerender } = render(renderTree());

        // The opening payload: no overlay yet.
        expect(screen.queryByText('Heat Results')).not.toBeInTheDocument();

        // Heat 2 finishes.
        timingStats = { ...timingStats, heatId: 2, recordedAt: '2026-01-01T00:05:00Z' };
        act(() => {
            rerender(renderTree());
        });

        expect(screen.getByText('Heat Results')).toBeInTheDocument();
        expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();
        const firstPlaceRow = screen.getByText('Speedy McQueen').closest('.overlay-result-item');
        expect(firstPlaceRow).toHaveClass('first-place');
        const avatarImg = screen.getByAltText('Speedy McQueen');
        expect(avatarImg).toHaveAttribute('src', 'http://example.com/speedy.jpg');

        // Fast-forward past the 5-second timeout.
        act(() => {
            vi.advanceTimersByTime(6000);
        });
        expect(screen.queryByText('Heat Results')).not.toBeInTheDocument();

        // Heat 2 is re-recorded — same round, same heat number, same heat id
        // — but a new `recordedAt`. The old key (`roundName`-`heatNumber`)
        // never changed for this case, so the overlay never fired again.
        timingStats = { ...timingStats, recordedAt: '2026-01-01T00:10:00Z' };
        act(() => {
            rerender(renderTree());
        });

        expect(screen.getByText('Heat Results')).toBeInTheDocument();

        vi.useRealTimers();
    });

    describe('naming this screen (#495)', () => {
        const renderTree = () => (
            <MemoryRouter initialEntries={['/race/1/observation']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        it('shows a small badge naming the screen on its first payload, not the flash', async () => {
            setupMocks({
                displayAssignment: { name: 'Plucky Puffin', identifySeq: 3, assigned: false, view: 'STANDINGS', cycleSeconds: 10 },
            });

            render(renderTree());

            await waitFor(() => {
                expect(screen.getByTestId('identify-connect-badge')).toHaveTextContent('Plucky Puffin');
            });
            expect(screen.queryByTestId('identify-flash')).not.toBeInTheDocument();
        });

        it('flashes the name across the screen when identifySeq rises after the opening payload', async () => {
            let displayAssignment: any = {
                name: 'Plucky Puffin',
                identifySeq: 3,
                assigned: false,
                view: 'STANDINGS',
                cycleSeconds: 10,
            };
            (useQuery as any).mockReturnValue([{ data: mockRacersData, fetching: false, error: null }]);
            (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
                if (query === LeaderboardSubscription) return [{ data: { leaderboard: [] } }];
                if (query === OnDeckSubscription) return [{ data: { onDeck: [] } }];
                if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: null } }];
                if (query === TimingStatsSubscription) return [{ data: { timingStats: null } }];
                if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: null } }];
                if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: null } } } }];
                if (query === DisplayAssignmentSubscription) return [{ data: { displayAssignment } }];
                return [{ data: null }];
            });

            const { rerender } = render(renderTree());
            await waitFor(() => {
                expect(screen.getByTestId('identify-connect-badge')).toBeInTheDocument();
            });
            expect(screen.queryByTestId('identify-flash')).not.toBeInTheDocument();

            // The operator presses Identify: the seq this display already
            // holds rises.
            displayAssignment = { ...displayAssignment, identifySeq: 4 };
            act(() => {
                rerender(renderTree());
            });

            expect(screen.getByTestId('identify-flash')).toHaveTextContent('Plucky Puffin');
        });

        it('ignores the seq a reconnect arrives holding — must not flash on a wifi hiccup', async () => {
            // A fresh mount with no prior `seen` gets the connect badge for
            // whatever seq it opens with, never the full-screen flash — the
            // same `seen === null` rule `resultsOverlay.ts` uses.
            setupMocks({
                displayAssignment: { name: 'Plucky Puffin', identifySeq: 7, assigned: false, view: 'STANDINGS', cycleSeconds: 10 },
            });

            render(renderTree());

            await waitFor(() => {
                expect(screen.getByTestId('identify-connect-badge')).toBeInTheDocument();
            });
            expect(screen.queryByTestId('identify-flash')).not.toBeInTheDocument();
        });

        it('shows nothing when this display has not been told a name yet', async () => {
            setupMocks({ displayAssignment: null });

            render(renderTree());

            await waitFor(() => {
                expect(screen.getByText('Now Racing')).toBeInTheDocument();
            });
            expect(screen.queryByTestId('identify-connect-badge')).not.toBeInTheDocument();
            expect(screen.queryByTestId('identify-flash')).not.toBeInTheDocument();
        });
    });
});
