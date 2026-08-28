// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Standings from './Standings';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useQuery, useSubscription } from 'urql';
import { tiedLeaderboardEntries } from '../testFixtures';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useSubscription: vi.fn(() => [{ data: undefined }, vi.fn()]),
    };
});

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Standings', () => {
    it('displays race name and standings, in rank order, ties included (#226)', async () => {
        const mockData = {
            race: {
                id: 1,
                name: 'Test Race',
                scoringStrategy: 'TIMED',
                // A shared rank, not just two rows — the page renders the
                // Leaderboard component directly, so a tie has to survive
                // that boundary too.
                leaderboard: tiedLeaderboardEntries,
            }
        };

        (useQuery as any).mockReturnValue([{
            data: { race: mockData.race },
            fetching: false,
            error: null
        }, vi.fn()]);

        (vi.mocked(useSubscription) as any).mockReturnValue([{
            data: { leaderboard: mockData.race.leaderboard },
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/race/1/standings']}>
                <Routes>
                    <Route path="/race/:raceId/standings" element={<Standings />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Current Standings')).toBeInTheDocument();
        });

        // Read as rows, in order, not merely as present text — a page
        // rendering the two tied racers in the wrong order, or dropping the
        // tie down to a single rank 1, would still pass a bare presence
        // check.
        const rows = screen.getAllByRole('row');
        expect(rows).toHaveLength(3);
        expect(rows[1]).toHaveTextContent('John Doe');
        expect(rows[1]).toHaveTextContent('Tigers');
        expect(rows[1]).toHaveTextContent('🥇 1');
        expect(rows[2]).toHaveTextContent('Jane Smith');
        expect(rows[2]).toHaveTextContent('🥇 1');
    });

    it('shows no results message when leaderboard has no completed heats', async () => {
        const mockData = {
            race: {
                id: 1,
                name: 'Test Race',
                scoringStrategy: 'TIMED',
                leaderboard: [
                    { racerId: 1, firstName: 'Fast', lastName: 'Driver', carNumber: 10, denName: 'Tigers', score: 0, heatsCompleted: 0, rank: 1 },
                    { racerId: 2, firstName: 'Slow', lastName: 'Driver', carNumber: 20, denName: 'Wolves', score: 0, heatsCompleted: 0, rank: 2 }
                ]
            }
        };

        (useQuery as any).mockReturnValue([{
            data: { race: mockData.race },
            fetching: false,
            error: null
        }, vi.fn()]);

        (vi.mocked(useSubscription) as any).mockReturnValue([{
            data: { leaderboard: mockData.race.leaderboard },
            fetching: false,
            error: null
        }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/race/1/standings']}>
                <Routes>
                    <Route path="/race/:raceId/standings" element={<Standings />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('No results yet. Complete some heats to see standings!')).toBeInTheDocument();
        });

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('reports an invalid race id instead of rendering the leaderboard', () => {
        // The page's one branch of its own — everything else is Leaderboard's.
        (useQuery as any).mockReturnValue([{ data: undefined, fetching: false, error: null }, vi.fn()]);
        (vi.mocked(useSubscription) as any).mockReturnValue([{ data: undefined, fetching: false, error: null }, vi.fn()]);

        render(
            <MemoryRouter initialEntries={['/race/not-a-number/standings']}>
                <Routes>
                    <Route path="/race/:raceId/standings" element={<Standings />} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText('Invalid Race ID')).toBeInTheDocument();
        expect(screen.queryByText('Current Standings')).not.toBeInTheDocument();
    });
});
