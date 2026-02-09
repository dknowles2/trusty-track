import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child components to isolate RaceControl logic
vi.mock('../components/race-control/ScheduleManagement', () => ({
    ScheduleManagement: ({ laneCount }: any) => (
        <div data-testid="schedule-management">
            Schedule Management
            <div data-testid="lane-count-prop">{laneCount}</div>
        </div>
    )
}));

vi.mock('../components/race-control/RaceExecution', () => ({
    RaceExecution: ({ onRunHeat, activeExecutionHeat, timerType, onUpdateResult }: any) => (
        <div data-testid="race-execution">
            Race Execution
            {activeExecutionHeat && <div data-testid="active-heat-id">{activeExecutionHeat.id}</div>}
            <button onClick={() => onRunHeat({ 
                id: 1, 
                heat_number: 1, 
                lane_results: JSON.stringify([{ lane: 1, time: 3.5, place: 1 }]) 
            }, true)}>Run Heat 1</button>
            <button onClick={() => {
                // Simulate finishing heat
                onUpdateResult(1, [{ lane: 1, time: 4.5, place: 1 }]);
            }}>Finish Heat 1</button>
            <div data-testid="timer-type">{timerType}</div>
        </div>
    )
}));

// Mock the API client
vi.mock('../api/client', () => ({
    apiClient: {
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
    }
}));

import RaceControl from './RaceControl';
import { apiClient } from '../api/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../context/AlertContext';

describe('RaceControl Page', () => {
    const mockRaceId = '1';
    
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock initial data fetch
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url.includes(`/races/${mockRaceId}/heats`)) {
                return Promise.resolve([
                    { id: 1, round_number: 1, heat_number: 1, lane_results: JSON.stringify([{ lane: 1, time: 3.5, place: 1 }]) }, // Completed heat
                    { id: 2, round_number: 1, heat_number: 2, lane_results: '[]' }
                ]);
            }
            if (url.includes(`/races/${mockRaceId}/racers`)) {
                return Promise.resolve([
                    { id: 101, first_name: 'A', last_name: 'B', car_number: 101 },
                    { id: 102, first_name: 'C', last_name: 'D', car_number: 102 }
                ]);
            }
            if (url.includes(`/races/${mockRaceId}/dens`)) {
                return Promise.resolve([]);
            }
            if (url === `/races/${mockRaceId}`) {
                return Promise.resolve({ id: 1, name: 'Test Race', track_id: 1, championship_trophies: 3 });
            }
            if (url === '/tracks/1') {
                return Promise.resolve({ id: 1, name: 'Main Track', lane_count: 4, timer_type: 'FAKE' });
            }
            if (url === '/tracks/6') {
                return Promise.resolve({ id: 6, name: '6-Lane Track', lane_count: 6, timer_type: 'FAKE' });
            }
            return Promise.resolve({});
        });
    });

    it('clears previous results when re-running a completed heat', async () => {
        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Race/i }));

        await waitFor(() => {
            expect(screen.getByTestId('race-execution')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Run Heat 1'));

        await waitFor(() => {
            expect(apiClient.put).toHaveBeenCalledWith('/heats/1', expect.objectContaining({
                lane_results: expect.stringMatching(/\[.*"time":null.*\]|\[\]/) 
            }));
        });
    });

    it('clears activeHeatId when results are updated (finish heat)', async () => {
         render(
             <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );
        
        await waitFor(() => expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Race/i }));
        
        await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Finish Heat 1'));

        await waitFor(() => {
             expect(apiClient.put).toHaveBeenCalledWith('/heats/1', expect.objectContaining({
                lane_results: expect.stringMatching(/.*"time":4.5.*/)
            }));
        });
    });

    it('propagates laneCount from initial config', async () => {
        // Redefine mock for this specific test
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url.includes(`/races/${mockRaceId}/heats`)) return Promise.resolve([]);
            if (url.includes(`/races/${mockRaceId}/racers`)) return Promise.resolve([]);
            if (url.includes(`/races/${mockRaceId}/dens`)) return Promise.resolve([]);
            if (url === `/races/${mockRaceId}`) {
                return Promise.resolve({ id: 1, name: 'Test Race', track_id: 6, championship_trophies: 3 });
            }
            if (url === '/tracks/6') {
                return Promise.resolve({ id: 6, name: '6-Lane Track', lane_count: 6, timer_type: 'FAKE' });
            }
            return Promise.resolve({});
        });

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('lane-count-prop')).toHaveTextContent('6');
        });
    });
});
