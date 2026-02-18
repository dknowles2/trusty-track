// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Standings from './Standings';
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

describe('Standings', () => {
    it('displays race name and standings', async () => {
        const mockData = {
            race: {
                id: 1,
                name: 'Test Race',
                scoringStrategy: 'TIMED',
                leaderboard: [
                    {
                        racerId: 1,
                        firstName: 'John',
                        lastName: 'Doe',
                        carNumber: 101,
                        denName: 'Tigers',
                        score: 3.5,
                        heatsCompleted: 1,
                        rank: 1
                    }
                ]
            }
        };

        (useQuery as any).mockReturnValue([{
            data: mockData,
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
            expect(screen.getByText('Test Race - Standings')).toBeInTheDocument();
        });

        expect(screen.getByText('Back to Race Details')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Tigers')).toBeInTheDocument();
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
            data: mockData,
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
            expect(screen.getByText('Test Race - Standings')).toBeInTheDocument();
        });

        expect(screen.getByText('No results yet. Complete some heats to see standings!')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
});
