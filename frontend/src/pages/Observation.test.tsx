// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import Observation from './Observation';
import { apiClient } from '../api/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock apiClient
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
    }
}));

describe('Observation Page', () => {
    const mockRacers = [
        { id: 1, first_name: 'Speedy', last_name: 'McQueen', car_number: 95, racer_image_url: null },
        { id: 2, first_name: 'Doc', last_name: 'Hudson', car_number: 51, racer_image_url: null },
        { id: 3, first_name: 'Mater', last_name: 'Tow', car_number: 1, racer_image_url: null },
    ];

    const mockHeats = [
        // Heat 1: Completed
        { 
            id: 1, round_number: 1, heat_number: 1, 
            lane_results: JSON.stringify([
                { lane: 1, racer_id: 1, time: "3.5000" },
                { lane: 2, racer_id: 2, time: "3.6000" }
            ])
        },
        // Heat 2: Uncompleted (Current)
        { 
            id: 2, round_number: 1, heat_number: 2, 
            lane_results: JSON.stringify([
                { lane: 1, racer_id: 2, time: null },
                { lane: 2, racer_id: 3, time: null }
            ])
        },
        // Heat 3: Uncompleted (On Deck)
        { 
            id: 3, round_number: 1, heat_number: 3, 
            lane_results: JSON.stringify([
                { lane: 1, racer_id: 3, time: null },
                { lane: 2, racer_id: 1, time: null }
            ])
        },
        // Heat 4: Uncompleted (Future)
        { 
            id: 4, round_number: 2, heat_number: 1, 
            lane_results: null 
        }
    ];

    it('displays Now Racing and On Deck heats correctly', async () => {
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url.includes('/racers/')) return Promise.resolve(mockRacers);
            if (url.includes('/heats')) return Promise.resolve(mockHeats);
            return Promise.resolve([]);
        });

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            // Verify Now Racing (Heat 2)
            const nowRacing = screen.getByText('🔥 Now Racing');
            expect(nowRacing).toBeInTheDocument();
            // Check for content within relevant area if possible, or just text presence globally for simplicity first
            expect(screen.getByText('(Round 1, Heat 2)')).toBeInTheDocument();
            
            // Verify On Deck (Heat 3)
            const onDeck = screen.getByText('🔜 On Deck');
            expect(onDeck).toBeInTheDocument();
            expect(screen.getByText('(Round 1, Heat 3)')).toBeInTheDocument();
        });

        // Verify Racers in Now Racing (Doc Hudson vs Mater Tow)
        // They appear in both the Heat Card and the Standings table, so getAll is appropriate
        expect(screen.getAllByText('Doc Hudson').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mater Tow').length).toBeGreaterThan(0);
    });

    it('handles case with no upcoming heats', async () => {
        const completedHeatsOnly = [
             { 
                id: 1, round_number: 1, heat_number: 1, 
                lane_results: JSON.stringify([
                    { lane: 1, racer_id: 1, time: "3.5000" }
                ])
            }
        ];

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url.includes('/racers/')) return Promise.resolve(mockRacers);
            if (url.includes('/heats')) return Promise.resolve(completedHeatsOnly);
            return Promise.resolve([]);
        });

        render(
            <MemoryRouter initialEntries={['/races/1/observation']}>
                <Routes>
                    <Route path="/races/:raceId/observation" element={<Observation />} />
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            // Should see headers but "No heat scheduled"
            expect(screen.getByText('🔥 Now Racing')).toBeInTheDocument();
            expect(screen.getAllByText('No heat scheduled')).toHaveLength(2); // One for Current, one for Next
        });
    });
});
