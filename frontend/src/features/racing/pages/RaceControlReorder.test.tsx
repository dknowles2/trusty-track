import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';

// Mock child components
vi.mock('../components/ScheduleManagement', () => ({
    ScheduleManagement: ({ onRunHeat, heats }: any) => (
        <div data-testid="schedule-management">
            {heats.map((heat: any) => (
                <button key={heat.id} onClick={() => onRunHeat(heat, true)}>
                    Run Heat {heat.id}
                </button>
            ))}
        </div>
    )
}));

vi.mock('../components/RaceExecution', () => ({
    RaceExecution: () => <div data-testid="race-execution">Race Execution</div>
}));

vi.mock('../components/FreeRaceTab', () => ({
    FreeRaceTab: () => <div data-testid="free-race-tab">Free Race Tab</div>
}));

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(),
        useSubscription: vi.fn(),
    };
});

describe('RaceControl Reordering on Run', () => {
    const mockRaceId = '1';
    
    const mockRaceData = {
        race: {
            id: 1,
            name: 'Test Race',
            track: { id: 1, laneCount: 4, timerType: 'FAKE' },
            dens: [],
            racers: [],
            heats: [
                { id: 1, roundId: 10, roundNumber: 1, heatNumber: 1, laneResults: JSON.stringify([{ lane: 1, time: 3.5, place: 1 }]) }, // Completed
                { id: 2, roundId: 10, roundNumber: 1, heatNumber: 2, laneResults: '[]' }, // Next
                { id: 3, roundId: 10, roundNumber: 1, heatNumber: 3, laneResults: '[]' }  // Future
            ]
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useQuery as any).mockReturnValue([{ data: mockRaceData, fetching: false }, vi.fn()]);
        (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
    });

    it('reorders heats when clicking "Run" on a future heat', async () => {
        const mockMutation = vi.fn().mockResolvedValue({ data: { reorderHeats: { updatedCount: 3 } } });
        (useMutation as any).mockImplementation((query: any) => {
            const qStr = JSON.stringify(query);
            if (qStr.includes('reorderHeats')) {
                return [{ fetching: false }, mockMutation];
            }
            return [{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })];
        });

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control/schedule`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());

        // Click "Run Heat 3"
        fireEvent.click(screen.getByText('Run Heat 3'));

        await waitFor(() => {
            expect(mockMutation).toHaveBeenCalled();
        });

        // Expect Heat 3 to move to position 2, and Heat 2 to move to position 3
        const calls = mockMutation.mock.calls[0][0];
        expect(calls.heatUpdates).toContainEqual({ heatId: 3, newHeatNumber: 2 });
        expect(calls.heatUpdates).toContainEqual({ heatId: 2, newHeatNumber: 3 });
        expect(calls.heatUpdates).toContainEqual({ heatId: 1, newHeatNumber: 1 });
    });

    it('does NOT reorder if clicking "Run" on the NEXT heat', async () => {
        const mockMutation = vi.fn().mockResolvedValue({ data: { reorderHeats: { updatedCount: 3 } } });
        (useMutation as any).mockImplementation((query: any) => {
            const qStr = JSON.stringify(query);
            if (qStr.includes('reorderHeats')) {
                return [{ fetching: false }, mockMutation];
            }
            return [{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })];
        });

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control/schedule`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());

        // Click "Run Heat 2" (which is already next)
        fireEvent.click(screen.getByText('Run Heat 2'));

        // Reorder mutation should NOT have been called
        expect(mockMutation).not.toHaveBeenCalled();
    });
});
