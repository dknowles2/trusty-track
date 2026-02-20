// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Observation from './Observation';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import { 
    LeaderboardSubscription, 
    OnDeckSubscription, 
    CurrentlyRacingSubscription, 
    TimingStatsSubscription,
    ActiveFreeRaceHeatSubscription
} from '../graphql/observation';

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
            ...overrides
        };

        (useSubscription as any).mockImplementation(({ query }: { query: any }) => {
            if (query === LeaderboardSubscription) return [{ data: { leaderboard: defaultSubs.leaderboard } }];
            if (query === OnDeckSubscription) return [{ data: { onDeck: defaultSubs.onDeck } }];
            if (query === CurrentlyRacingSubscription) return [{ data: { currentlyRacing: defaultSubs.currentlyRacing } }];
            if (query === TimingStatsSubscription) return [{ data: { timingStats: defaultSubs.timingStats } }];
            if (query === ActiveFreeRaceHeatSubscription) return [{ data: { activeFreeRaceHeat: defaultSubs.activeFreeRaceHeat } }];
            return [{ data: null }];
        });
    };

    it('displays Now Racing and On Deck heats correctly', async () => {
        setupMocks({
            currentlyRacing: { 
                id: 2, roundNumber: 1, heatNumber: 2, 
                laneResults: JSON.stringify([{ lane: 1, racer_id: 2 }]) 
            },
            onDeck: [
                { id: 3, firstName: 'Mater', lastName: 'Tow', carNumber: 1, racerImageUrl: null }
            ]
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

    it('shows active free race heat in Now Racing when no official heat is running', async () => {
        setupMocks({
            activeFreeRaceHeat: {
                id: 99,
                laneAssignments: JSON.stringify([{ lane: 1, racer_id: 1 }]),
                laneResults: null,
            }
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

    it('official heat takes priority over free race heat', async () => {
        setupMocks({
            currentlyRacing: { 
                id: 2, roundNumber: 1, heatNumber: 2, 
                laneResults: JSON.stringify([{ lane: 1, racer_id: 2 }]) 
            },
            activeFreeRaceHeat: {
                id: 99,
                laneAssignments: JSON.stringify([{ lane: 1, racer_id: 1 }]),
            }
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
});
