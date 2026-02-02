// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RaceDetails from './RaceDetails';
import { apiClient } from '../api/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock apiClient
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
    }
}));

describe('RaceDetails', () => {
    it('displays human-readable race settings', async () => {
        // Mock race data with enum values
        const mockRace = {
            id: 1,
            name: 'Test Race',
            date_time: '2024-03-15T10:00:00',
            location: 'Test Location',
            scheduling_strategy: 'LANE_ROTATION',
            scoring_strategy: 'TIMED',
            car_numbering_strategy: 'PER_GROUP',
            group_id: 1,
            global_start_number: 1
        };

        // Setup mock return values
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/races/1') return Promise.resolve(mockRace);
            if (url.includes('/racers/')) return Promise.resolve([]);
            if (url.includes('/dens/')) return Promise.resolve([]);
            return Promise.resolve({});
        });

        render(
            <MemoryRouter initialEntries={['/races/1']}>
                <Routes>
                    <Route path="/races/:raceId" element={<RaceDetails />} />
                </Routes>
            </MemoryRouter>
        );

        // Wait for race details to load
        await waitFor(() => {
            expect(screen.getByText('Test Race')).toBeInTheDocument();
        });

        // Verify human-readable settings are displayed
        expect(screen.getByText('Lane Rotation')).toBeInTheDocument();
        expect(screen.getByText('Timed')).toBeInTheDocument();
        expect(screen.getByText('Per Den')).toBeInTheDocument();
    });
});
