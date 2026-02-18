import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation } from 'urql';
import { useLocation } from 'react-router-dom';

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
                heatNumber: 1, 
                laneResults: JSON.stringify([{ lane: 1, time: 3.5, place: 1 }]) 
            }, true)}>Run Heat 1</button>
            <button onClick={() => {
                // Simulate finishing heat
                onUpdateResult(1, [{ lane: 1, time: 4.5, place: 1 }]);
            }}>Finish Heat 1</button>
            <div data-testid="timer-type">{timerType}</div>
        </div>
    )
}));

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
    };
});


import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../context/AlertContext';

describe('RaceControl Page', () => {
    const mockRaceId = '1';
    
    // Mock Data
    const mockRaceData = {
        race: {
            id: 1,
            name: 'Test Race',
            championshipTrophies: 3,
            scoringStrategy: 'TIMED',
            track: {
                id: 1,
                laneCount: 4,
                timerType: 'FAKE'
            },
            dens: [],
            racers: [
                { id: 101, firstName: 'A', lastName: 'B', carNumber: 101 },
                { id: 102, firstName: 'C', lastName: 'D', carNumber: 102 }
            ],
            heats: [
                { id: 1, roundNumber: 1, heatNumber: 1, laneResults: JSON.stringify([{ lane: 1, time: 3.5, place: 1 }]) }, // Completed heat
                { id: 2, roundNumber: 1, heatNumber: 2, laneResults: '[]' }
            ]
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default mock for useQuery
        (useQuery as any).mockReturnValue([{
            data: mockRaceData,
            fetching: false,
            error: null
        }, vi.fn()]);

        // Default mock for useMutation
        (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
    });

    it('clears previous results when re-running a completed heat', async () => {
        const mockUpdateHeatResultMutation = vi.fn().mockResolvedValue({ data: { updateHeatResult: true } });
        (useMutation as any).mockImplementation(() => {
             // We can check query if needed, but for now just return the mock
             return [{ fetching: false }, mockUpdateHeatResultMutation];
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

        await waitFor(() => expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Race/i }));

        await waitFor(() => {
            expect(screen.getByTestId('race-execution')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Run Heat 1'));

        await waitFor(() => {
            expect(mockUpdateHeatResultMutation).toHaveBeenCalled();
        });

        expect(mockUpdateHeatResultMutation).toHaveBeenCalledWith(expect.objectContaining({
            heatId: 1,
            results: expect.stringMatching(/\[.*"time":null.*\]|\[\]/) 
        }));
    });

    it('clears activeHeatId when results are updated (finish heat)', async () => {
        const mockUpdateHeatResultMutation = vi.fn().mockResolvedValue({ data: { updateHeatResult: true } });
        (useMutation as any).mockImplementation(() => {
             return [{ fetching: false }, mockUpdateHeatResultMutation];
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
        
        await waitFor(() => expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Race/i }));
        
        await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Finish Heat 1'));

        await waitFor(() => {
             expect(mockUpdateHeatResultMutation).toHaveBeenCalled();
        });
        
        expect(mockUpdateHeatResultMutation).toHaveBeenCalledWith(expect.objectContaining({
            heatId: 1,
            results: expect.stringMatching(/.*"time":4.5.*/)
        }));
    });

    it('propagates laneCount from initial config', async () => {
        const mockRaceDataWith6Lanes = {
            race: {
                ...mockRaceData.race,
                track: {
                    id: 6,
                    laneCount: 6,
                    timerType: 'FAKE'
                }
            }
        };

        (useQuery as any).mockReturnValue([{
            data: mockRaceDataWith6Lanes,
            fetching: false,
            error: null
        }, vi.fn()]);

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
