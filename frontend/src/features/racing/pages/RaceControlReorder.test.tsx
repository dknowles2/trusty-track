import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';

// Captures the real (unmocked) onReorderHeats function RaceControl hands
// down, so a test can call it directly the way ScheduleManagement's own
// drag-end handler does — without mocking ScheduleManagement's own
// catch/toast/revert, which is exercised separately in
// ScheduleManagement.test.tsx.
let capturedOnReorderHeats: ((updates: { heat_id: number, new_heat_number: number }[]) => Promise<void>) | undefined;

// Mock child components
vi.mock('../components/ScheduleManagement', () => ({
    ScheduleManagement: ({ onRunHeat, onReorderHeats, heats }: any) => {
        capturedOnReorderHeats = onReorderHeats;
        return (
            <div data-testid="schedule-management">
                {heats.map((heat: any) => (
                    <button key={heat.id} onClick={() => onRunHeat(heat, true)}>
                        Run Heat {heat.id}
                    </button>
                ))}
            </div>
        );
    }
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
                { id: 1, roundId: 10, roundNumber: 1, heatNumber: 1, lanes: [{ lane: 1, racerId: null, placeholderSlot: null, time: 3.5, place: 1, skipped: false }] }, // Completed
                { id: 2, roundId: 10, roundNumber: 1, heatNumber: 2, lanes: [] }, // Next
                { id: 3, roundId: 10, roundNumber: 1, heatNumber: 3, lanes: [] }  // Future
            ]
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        capturedOnReorderHeats = undefined;
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

    it('rejects the onReorderHeats prop passed to ScheduleManagement on a failed mutation (#443)', async () => {
        // Regression test for the drag-reorder toast being dead code: the
        // wrapper handed to ScheduleManagement used to `await` the internal
        // helper and discard its success/failure result, so it always
        // resolved and ScheduleManagement's own catch/toast/revert never
        // ran. It must now propagate the failure.
        const mockMutation = vi.fn().mockResolvedValue({ error: new Error('reorder failed') });
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
        expect(capturedOnReorderHeats).toBeDefined();

        await expect(
            capturedOnReorderHeats!([{ heat_id: 2, new_heat_number: 1 }])
        ).rejects.toBeTruthy();

        expect(mockMutation).toHaveBeenCalled();
    });
});
