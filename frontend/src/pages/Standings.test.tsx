// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Standings from './Standings';
import { apiClient } from '../api/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Cleanup after each test
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Mock apiClient
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
    }
}));

describe('Standings', () => {
    it('displays race name and standings', async () => {
        const mockRace = {
            id: 1,
            name: 'Test Race',
        };

        const mockLeaderboard = {
            race_id: 1,
            scoring_strategy: 'TIMED',
            leaderboard: [
                {
                    racer_id: 1,
                    first_name: 'John',
                    last_name: 'Doe',
                    car_number: 101,
                    den_name: 'Tigers',
                    score: 3.5,
                    heats_completed: 1,
                    rank: 1
                }
            ]
        };

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url === '/races/1/scores') return Promise.resolve(mockLeaderboard);
            return Promise.resolve({});
        });

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
        const mockRace = {
            id: 1,
            name: 'Test Race'
        };

        const mockLeaderboard = {
            race_id: 1,
            scoring_strategy: 'TIMED',
            leaderboard: [
                { racer_id: 1, first_name: 'Fast', last_name: 'Driver', car_number: 10, den_name: 'Tigers', score: 0, heats_completed: 0, rank: 1 },
                { racer_id: 2, first_name: 'Slow', last_name: 'Driver', car_number: 20, den_name: 'Wolves', score: 0, heats_completed: 0, rank: 2 }
            ]
        };

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url === '/races/1/scores') return Promise.resolve(mockLeaderboard);
            return Promise.resolve({});
        });

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
