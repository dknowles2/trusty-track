// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Observation from './Observation';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery } from 'urql';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Observation Page', () => {
    const mockRaceData = {
        race: {
            id: 1,
            name: 'Test Race',
            racers: [
                { id: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, racerImageUrl: null },
                { id: 2, firstName: 'Doc', lastName: 'Hudson', carNumber: 51, racerImageUrl: null },
                { id: 3, firstName: 'Mater', lastName: 'Tow', carNumber: 1, racerImageUrl: null },
            ],
            heats: [
                // Heat 1: Completed
                { 
                    id: 1, roundNumber: 1, heatNumber: 1, 
                    laneResults: JSON.stringify([
                        { lane: 1, racer_id: 1, time: "3.5000" },
                        { lane: 2, racer_id: 2, time: "3.6000" }
                    ])
                },
                // Heat 2: Uncompleted (Current)
                { 
                    id: 2, roundNumber: 1, heatNumber: 2, 
                    laneResults: JSON.stringify([
                        { lane: 1, racer_id: 2, time: null },
                        { lane: 2, racer_id: 3, time: null }
                    ])
                },
                // Heat 3: Uncompleted (On Deck)
                { 
                    id: 3, roundNumber: 1, heatNumber: 3, 
                    laneResults: JSON.stringify([
                        { lane: 1, racer_id: 3, time: null },
                        { lane: 2, racer_id: 1, time: null }
                    ])
                },
                // Heat 4: Uncompleted (Future)
                { 
                    id: 4, roundNumber: 2, heatNumber: 1, 
                    laneResults: null 
                }
            ]
        }
    };

    // Extend base mock data to include activeFreeRaceHeat: null (no exhibition)
    const mockRaceDataWithFreeRace = {
        ...mockRaceData,
        activeFreeRaceHeat: null,
    };

    it('displays Now Racing and On Deck heats correctly', async () => {
        (useQuery as any).mockReturnValue([{
            data: mockRaceDataWithFreeRace,
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            // Verify Now Racing (Heat 2)
            const nowRacing = screen.getByText('Now Racing');
            expect(nowRacing).toBeInTheDocument();
            expect(screen.getByText('(Round 1, Heat 2)')).toBeInTheDocument();
            
            // Verify On Deck (Heat 3)
            const onDeck = screen.getByText('On Deck');
            expect(onDeck).toBeInTheDocument();
            expect(screen.getByText('(Round 1, Heat 3)')).toBeInTheDocument();
        });

        // Verify Racers in Now Racing (Doc Hudson vs Mater Tow)
        expect(screen.getAllByText('Doc Hudson').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mater Tow').length).toBeGreaterThan(0);
    });

    it('handles case with no upcoming heats', async () => {
        const mockDataNoUpcoming = {
            race: {
                ...mockRaceData.race,
                heats: [
                    {
                        id: 1, roundNumber: 1, heatNumber: 1,
                        laneResults: JSON.stringify([
                            { lane: 1, racer_id: 1, time: "3.5000" }
                        ])
                    }
                ]
            },
            activeFreeRaceHeat: null,
        };

        (useQuery as any).mockReturnValue([{
            data: mockDataNoUpcoming,
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
            expect(screen.getAllByText('No heat scheduled')).toHaveLength(2);
        });
    });

    // ---- Free Race / Exhibition tests ----

    const activeFreeRaceHeat = {
        id: 99,
        laneAssignments: JSON.stringify([
            { lane: 1, racer_id: 1, time: null, place: null },
            { lane: 2, racer_id: 2, time: null, place: null },
        ]),
        laneResults: null,
        createdAt: '2024-01-01T00:00:00Z',
    };

    // A data set where all official heats are completed
    const allCompletedRaceData = {
        race: {
            ...mockRaceData.race,
            heats: [
                {
                    id: 1, roundNumber: 1, heatNumber: 1,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 1, time: '3.5000' }]),
                },
            ],
            leaderboard: [],
        },
        activeFreeRaceHeat,
    };

    it('shows active free race heat in Now Racing when no official heat is running', async () => {
        (useQuery as any).mockReturnValue([{
            data: allCompletedRaceData,
            fetching: false,
            error: null,
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
        });
        // Lane 1 racer (Speedy McQueen, id=1) should appear in the Now Racing panel
        expect(screen.getAllByText('Speedy McQueen').length).toBeGreaterThan(0);
    });

    it('shows Exhibition badge when free race heat is displayed in Now Racing', async () => {
        (useQuery as any).mockReturnValue([{
            data: allCompletedRaceData,
            fetching: false,
            error: null,
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Exhibition')).toBeInTheDocument();
        });
    });

    it('official heat takes priority over free race heat and Exhibition badge is NOT shown', async () => {
        // Has an uncompleted official heat (heat 2) AND an active free race heat
        const mixedData = {
            race: mockRaceData.race,
            activeFreeRaceHeat,
        };

        (useQuery as any).mockReturnValue([{
            data: mixedData,
            fetching: false,
            error: null,
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('(Round 1, Heat 2)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Exhibition')).not.toBeInTheDocument();
    });

    it('completed free race heat (laneResults non-null) is NOT shown in Now Racing', async () => {
        const completedFreeRaceData = {
            race: {
                ...mockRaceData.race,
                heats: [
                    {
                        id: 1, roundNumber: 1, heatNumber: 1,
                        laneResults: JSON.stringify([{ lane: 1, racer_id: 1, time: '3.5000' }]),
                    },
                ],
                leaderboard: [],
            },
            activeFreeRaceHeat: {
                ...activeFreeRaceHeat,
                laneResults: JSON.stringify([
                    { lane: 1, racer_id: 1, time: 3.142, place: 1 },
                ]),
            },
        };

        (useQuery as any).mockReturnValue([{
            data: completedFreeRaceData,
            fetching: false,
            error: null,
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Now Racing')).toBeInTheDocument();
        });
        // No official heat running, no active free race heat → "No heat scheduled" in Now Racing
        expect(screen.getAllByText('No heat scheduled').length).toBeGreaterThan(0);
        expect(screen.queryByText('Exhibition')).not.toBeInTheDocument();
    });

    it('Live Standings table is unaffected when a free race heat is active', async () => {
        const dataWithStandings = {
            race: {
                ...allCompletedRaceData.race,
                leaderboard: [
                    { racerId: 1, firstName: 'Speedy', lastName: 'McQueen', carNumber: 95, score: 3.5, heatsCompleted: 2, rank: 1 },
                ],
            },
            activeFreeRaceHeat,
        };

        (useQuery as any).mockReturnValue([{
            data: dataWithStandings,
            fetching: false,
            error: null,
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Live Standings')).toBeInTheDocument();
        });
        expect(screen.getByText('3.5000s')).toBeInTheDocument();
    });
});
