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
    ActiveFreeRaceHeatSubscription
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

    const setupMocks = (overrides: any = {}) => {
        (useQuery as any).mockReturnValue([{ data: mockRacersData, fetching: false, error: null }]);

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
            ...overrides
        };

        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: defaultSubs.leaderboard } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: defaultSubs.onDeck } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: defaultSubs.currentlyRacing } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats: defaultSubs.timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: defaultSubs.activeFreeRaceHeat } }];
            if (query === TIMER_STATUS_SUBSCRIPTION) return [{ data: { timerStatus: { status: { activeHeatId: defaultSubs.armedHeatId } } } }];
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

    it('shows and hides the heat result overlay in projector mode', async () => {
        const timingStats = {
            heatId: 1,
            roundName: 'Round 1',
            heatNumber: 1,
            lanes: [
                { laneNumber: 1, racerName: 'Speedy McQueen', carName: '95', time: 3.5, place: 1, racerImageUrl: 'http://example.com/speedy.jpg' },
                { laneNumber: 2, racerName: 'Doc Hudson', carName: '51', time: 3.6, place: 2, racerImageUrl: null },
            ]
        };

        setupMocks({ timingStats });

        vi.useFakeTimers();

        render(
            <MemoryRouter initialEntries={['/race/1/observation?projector=true']}>
                <Routes>
                    <Route path="/race/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        // Overlay should be visible
        expect(screen.getByText('Heat Results')).toBeInTheDocument();
        expect(screen.getByText('Speedy McQueen')).toBeInTheDocument();

        // Check for trophy icons (by checking if the Icon component renders an SVG, implicitly)
        // Or better, check for the color style which distinguishes the trophies
        const firstPlaceRow = screen.getByText('Speedy McQueen').closest('.overlay-result-item');
        expect(firstPlaceRow).toHaveClass('first-place');
        // The trophy icon is inside .overlay-rank. We can check if it exists.
        // Since we can't easily check for the specific SVG path without more setup, we'll assume class presence and structure implies it.

        // We can check if the image is passed to RacerAvatar
        // RacerAvatar renders an img tag if racerImageUrl is present.
        const avatarImg = screen.getByAltText('Speedy McQueen');
        expect(avatarImg).toBeInTheDocument();
        expect(avatarImg).toHaveAttribute('src', 'http://example.com/speedy.jpg');


        // Fast-forward time
        act(() => {
            vi.advanceTimersByTime(6000);
        });

        // Overlay should be gone
        // Overlay should be gone
        expect(screen.queryByText('Heat Results')).not.toBeInTheDocument();

        vi.useRealTimers();
    });
});
