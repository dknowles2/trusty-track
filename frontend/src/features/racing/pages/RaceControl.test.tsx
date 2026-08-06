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
    RaceExecution: ({ onRunHeat, activeExecutionHeat, timerType, onUpdateResult, roundSummary }: any) => (
        <div data-testid="race-execution">
            Race Execution
            {activeExecutionHeat && <div data-testid="active-heat-id">{activeExecutionHeat.id}</div>}
            {roundSummary && <div data-testid="round-summary-id">{roundSummary.roundId}</div>}
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

    // ---------------------------------------------------------------------
    // Which heat is on screen (#105)
    // ---------------------------------------------------------------------
    //
    // This used to be written into state by an effect that watched both the
    // heats and the selection. It is derived now, and these pin the answers
    // the effect gave — plus the one it could not.

    const withHeats = (heats: unknown[]) => {
        (useQuery as any).mockReturnValue([{
            data: { race: { ...mockRaceData.race, heats } },
            fetching: false,
            error: null,
        }, vi.fn()]);
    };

    const ran = (id: number, roundNumber: number, heatNumber: number) => ({
        id, roundNumber, heatNumber,
        lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: 3.5, place: 1, skipped: false }],
    });
    const notRun = (id: number, roundNumber: number, heatNumber: number) => ({
        id, roundNumber, heatNumber,
        lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: null, place: null, skipped: false }],
    });

    const openRaceTab = async () => {
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
    };

    // ---------------------------------------------------------------------
    // When a round summary is news (#114)
    // ---------------------------------------------------------------------
    //
    // The rule itself is `decidedRoundIds` in `roundCompletion.ts`, and that is
    // where it is guarded — reverting it fails a test there. This is only the
    // wiring: that opening the screen on a fresh schedule raises nothing.

    const advancementStatus = (over: Record<string, unknown> = {}) => ({
        isReady: true,
        requiresAdvancement: true,
        alreadyAdvanced: true,
        source: 'PACK',
        numRacers: 3,
        advancingRacers: [],
        ...over,
    });

    const withRounds = (rounds: unknown[]) => {
        (useQuery as any).mockReturnValue([{
            data: { race: { ...mockRaceData.race, rounds } },
            fetching: false,
            error: null,
        }, vi.fn()]);
    };

    it('raises no summary for a schedule that has not been raced', async () => {
        withRounds([
            { id: 1, roundNumber: 1, name: 'Qualifying', advancementSource: null, advancementStatus: advancementStatus() },
            { id: 2, roundNumber: 2, name: 'Grand Finals', advancementSource: 'PACK', advancementStatus: advancementStatus({ alreadyAdvanced: false }) },
        ]);

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control/race`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());
        expect(screen.queryByTestId('round-summary-id')).not.toBeInTheDocument();
    });

    it('opens on the first heat that has not been run', async () => {
        withHeats([ran(1, 1, 1), ran(2, 1, 2), notRun(3, 1, 3), notRun(4, 1, 4)]);

        await openRaceTab();

        expect(screen.getByTestId('active-heat-id')).toHaveTextContent('3');
    });

    it('stays on the last heat once they have all run', async () => {
        // Otherwise the end of a race would jump back to the top of the list.
        withHeats([ran(1, 1, 1), ran(2, 1, 2), ran(3, 1, 3)]);

        await openRaceTab();

        expect(screen.getByTestId('active-heat-id')).toHaveTextContent('3');
    });

    it('orders by round before heat number', async () => {
        // The heats arrive in whatever order the server sent them.
        withHeats([notRun(9, 2, 1), ran(1, 1, 1), notRun(5, 1, 2)]);

        await openRaceTab();

        expect(screen.getByTestId('active-heat-id')).toHaveTextContent('5');
    });

    it('shows no heat at all when the race has none', async () => {
        // A race whose schedule has not been generated yet. The execution
        // panel is not rendered in that state, so there is nothing to select.
        withHeats([]);

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

        expect(screen.queryByTestId('active-heat-id')).not.toBeInTheDocument();
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
