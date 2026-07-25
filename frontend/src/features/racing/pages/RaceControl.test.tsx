import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';

// Mock child components to isolate RaceControl logic
vi.mock('../components/ScheduleManagement', () => ({
    ScheduleManagement: ({ laneCount }: any) => (
        <div data-testid="schedule-management">
            Schedule Management
            <div data-testid="lane-count-prop">{laneCount}</div>
        </div>
    )
}));

vi.mock('../components/RaceExecution', () => ({
    RaceExecution: ({ onRunHeat, activeExecutionHeat, timerType, onUpdateResult }: any) => (
        <div data-testid="race-execution">
            Race Execution
            {activeExecutionHeat && <div data-testid="active-heat-id">{activeExecutionHeat.id}</div>}
            <button onClick={() => onRunHeat({
                id: 1,
                heatNumber: 1, lanes: [{ lane: 1, racerId: null, placeholderSlot: null, time: 3.5, place: 1, skipped: false }]
            }, true)}>Run Heat 1</button>
            <button onClick={() => {
                // Simulate finishing heat
                onUpdateResult(1, [{ lane: 1, racerId: 1, placeholderSlot: null, time: 4.5, place: 1, skipped: false }]);
            }}>Finish Heat 1</button>
            <div data-testid="timer-type">{timerType}</div>
        </div>
    )
}));

vi.mock('../components/FreeRaceTab', () => ({
    FreeRaceTab: ({ raceId, laneCount, timerType }: any) => (
        <div data-testid="free-race-tab">
            Free Race Tab
            <div data-testid="free-race-race-id">{raceId}</div>
            <div data-testid="free-race-lane-count">{laneCount}</div>
            <div data-testid="free-race-timer-type">{timerType}</div>
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
        useSubscription: vi.fn(),
    };
});


import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';

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
                { id: 1, roundNumber: 1, heatNumber: 1, lanes: [{ lane: 1, racerId: null, placeholderSlot: null, time: 3.5, place: 1, skipped: false }] }, // Completed heat
                { id: 2, roundNumber: 1, heatNumber: 2, lanes: [] }
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

        // Default mock for useSubscription — does nothing by default
        (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
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
        // Use exact name to avoid matching "Free Race"
        fireEvent.click(screen.getByRole('button', { name: /^\s*Race\s*$/i }));

        await waitFor(() => {
            expect(screen.getByTestId('race-execution')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Run Heat 1'));

        await waitFor(() => {
            expect(mockUpdateHeatResultMutation).toHaveBeenCalled();
        });

        // Re-running sends the same lanes with every result cleared — no JSON
        // string to pattern-match any more (#5).
        expect(mockUpdateHeatResultMutation).toHaveBeenCalledWith({
            heatId: 1,
            lanes: [{ lane: 1, racerId: null, placeholderSlot: null, time: null, place: null, skipped: false }],
        });
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
        fireEvent.click(screen.getByRole('button', { name: /^\s*Race\s*$/i }));

        await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Finish Heat 1'));

        await waitFor(() => {
             expect(mockUpdateHeatResultMutation).toHaveBeenCalled();
        });

        expect(mockUpdateHeatResultMutation).toHaveBeenCalledWith({
            heatId: 1,
            lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: 4.5, place: 1, skipped: false }],
        });
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

    it('"Free Race" tab is rendered in the tab bar', async () => {
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
            expect(screen.getByRole('button', { name: /Free Race/i })).toBeInTheDocument();
        });
    });

    it('clicking "Free Race" tab renders FreeRaceTab', async () => {
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
            expect(screen.getByRole('button', { name: /Free Race/i })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /Free Race/i }));
        await waitFor(() => {
            expect(screen.getByTestId('free-race-tab')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('schedule-management')).not.toBeInTheDocument();
        expect(screen.queryByTestId('race-execution')).not.toBeInTheDocument();
    });

    it('switching from "Free Race" back to "Schedule" renders ScheduleManagement', async () => {
        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control/free-race`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );
        await waitFor(() => {
            expect(screen.getByTestId('free-race-tab')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
        await waitFor(() => {
            expect(screen.getByTestId('schedule-management')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('free-race-tab')).not.toBeInTheDocument();
    });

    it('calls reExecute when the raceStateChanged subscription fires', async () => {
        const mockReExecute = vi.fn();
        // Capture the subscription handler so we can invoke it later
        let capturedHandler: ((prev: any, data: any) => any) | undefined;

        (useQuery as any).mockReturnValue([{
            data: mockRaceData,
            fetching: false,
            error: null
        }, mockReExecute]);

        (useSubscription as any).mockImplementation(
            (_opts: any, handler: (prev: any, data: any) => any) => {
                capturedHandler = handler;
                return [{ data: undefined }, vi.fn()];
            }
        );

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
            expect(capturedHandler).toBeDefined();
        });

        // Simulate a subscription event arriving
        act(() => {
            capturedHandler!(undefined, { raceStateChanged: { raceId: 1, changedAt: '2024-01-01T00:00:00Z', kind: 'SCHEDULE' } });
        });

        expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });

    it('does NOT refetch when a heat result arrives with its payload', async () => {
        // Issue #12: the normalized cache merges the heat, so re-querying the
        // whole page is wasted work. This is the case that regresses silently —
        // if the predicate breaks, everything still *works*, just slowly.
        let capturedHandler: ((prev: any, data: any) => any) | undefined;
        const mockReExecute = vi.fn();

        (useQuery as any).mockReturnValue([{
            data: mockRaceData,
            fetching: false,
            error: null
        }, mockReExecute]);

        (useSubscription as any).mockImplementation(
            (_opts: any, handler: (prev: any, data: any) => any) => {
                capturedHandler = handler;
                return [{ data: undefined }, vi.fn()];
            }
        );

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
            expect(capturedHandler).toBeDefined();
        });

        mockReExecute.mockClear();

        act(() => {
            capturedHandler!(undefined, {
                raceStateChanged: {
                    raceId: 1,
                    changedAt: '2024-01-01T00:00:00Z',
                    kind: 'HEAT_RESULT',
                    heat: { id: 42 },
                },
            });
        });

        expect(mockReExecute).not.toHaveBeenCalled();
    });
});
