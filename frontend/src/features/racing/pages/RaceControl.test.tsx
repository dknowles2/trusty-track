import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';

// Mock child components to isolate RaceControl logic
vi.mock('../components/ScheduleManagement', () => ({
    ScheduleManagement: ({
        laneCount,
        activeHeatId,
        onAddRound,
        handPickRoundId,
        onOpenHandPickModal,
        onCloseHandPickModal,
        onPinRoundField,
        onUnpinRoundField,
        racerCount,
    }: any) => (
        <div data-testid="schedule-management">
            Schedule Management
            <div data-testid="lane-count-prop">{laneCount}</div>
            <div data-testid="racer-count-prop">{racerCount}</div>
            <div data-testid="schedule-active-heat-id">{activeHeatId ?? 'none'}</div>
            {/* The hand-pick wiring (#711) — a round created with the
                wizard's "I'll choose who races myself" checked, and the
                per-round "Pick by hand"/"Use standings" controls that live
                inside the real `ScheduleManagement`. Exposed here so
                `RaceControl`'s own side of that wiring — extracting the
                created round's id, waiting for it to appear in the
                refetched race data, and the pin/unpin mutation handlers —
                can be tested without rendering the real schedule table. */}
            <div data-testid="hand-pick-round-id">{handPickRoundId ?? 'none'}</div>
            <button onClick={() => onAddRound({ name: 'Finals', advancementSource: 'ALL', pickFieldByHand: true })}>
                Add Championship Round (pick by hand)
            </button>
            <button onClick={() => onAddRound({ name: 'All Pack' })}>
                Add General Round
            </button>
            <button onClick={() => onOpenHandPickModal?.(7)}>Pick by hand</button>
            <button onClick={() => onCloseHandPickModal?.()}>Close picker</button>
            <button onClick={() => onPinRoundField?.(7, [101, 102])}>Save line-up</button>
            <button onClick={() => onUnpinRoundField?.(7)}>Use standings</button>
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
            {/* Jumps ahead of an uncompleted heat, which is what triggers the
                reorder-then-navigate path in handleRunHeat (issue #416). */}
            <button onClick={() => onRunHeat({
                id: 3, roundId: 5,
                heatNumber: 3, lanes: [{ lane: 1, racerId: 3, placeholderSlot: null, time: null, place: null, skipped: false }]
            }, true)}>Run Heat 3 (jump ahead)</button>
            <button onClick={() => {
                // Simulate finishing heat
                onUpdateResult(1, [{ lane: 1, racerId: 1, placeholderSlot: null, time: 4.5, place: 1, skipped: false }]);
            }}>Finish Heat 1</button>
            <button onClick={() => {
                // Simulate editing a heat that holds a DNF (recorded 0.0) alongside
                // a real finisher, exactly as the editor sends it: raw, unsorted,
                // with whatever stale place each lane happened to carry.
                onUpdateResult(1, [
                    { lane: 1, racerId: 1, placeholderSlot: null, time: 0, place: 1, skipped: false },
                    { lane: 2, racerId: 2, placeholderSlot: null, time: 4.2, place: 2, skipped: false },
                ]);
            }}>Save Edit With DNF</button>
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
            racingGroups: [],
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
        source: 'ALL',
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
            { id: 2, roundNumber: 2, name: 'Grand Finals', advancementSource: 'ALL', advancementStatus: advancementStatus({ alreadyAdvanced: false }) },
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

    // -----------------------------------------------------------------------
    // A failed reorder must not move the operator on (#416)
    // -----------------------------------------------------------------------
    //
    // Pressing Run on a heat further along than the first uncompleted one
    // reorders the schedule to bring it forward. If that reorder fails on the
    // server, the operator must see why and must not be dropped onto the Race
    // tab believing the schedule moved — the timer would then arm whatever
    // heat is actually next, not the one they meant to run.

    it('shows an alert and does not select the heat when the run-button reorder fails', async () => {
        const mockMutate = vi.fn().mockResolvedValue({ error: new Error('Reorder failed') });
        (useMutation as any).mockImplementation(() => [{ fetching: false }, mockMutate]);

        withHeats([
            { id: 1, roundId: 5, heatNumber: 1, lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: 3.5, place: 1, skipped: false }] },
            { id: 2, roundId: 5, heatNumber: 2, lanes: [{ lane: 1, racerId: 2, placeholderSlot: null, time: null, place: null, skipped: false }] },
            { id: 3, roundId: 5, heatNumber: 3, lanes: [{ lane: 1, racerId: 3, placeholderSlot: null, time: null, place: null, skipped: false }] },
        ]);

        await openRaceTab();

        // The fallback selection is the first heat not yet run.
        expect(screen.getByTestId('active-heat-id')).toHaveTextContent('2');

        fireEvent.click(screen.getByText('Run Heat 3 (jump ahead)'));

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalled();
        });

        // The alert from the failed reorder, surfaced the same way every
        // other mutation handler in this file surfaces one.
        await waitFor(() => {
            expect(screen.getByText('Reorder failed')).toBeInTheDocument();
        });

        // Still showing heat 2 — the run button must not have selected heat 3
        // or navigated to the Race tab on a failed reorder.
        expect(screen.getByTestId('active-heat-id')).toHaveTextContent('2');
    });

    it('sends the finished heat\'s results to the server', async () => {
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

    // -----------------------------------------------------------------------
    // The Schedule view's running-heat protections (#345)
    // -----------------------------------------------------------------------
    //
    // `activeHeatId` used to be local state that was only ever cleared, so
    // `ScheduleManagement`'s orange border, drag block and "…" label could
    // never fire. It is now the heat session's own `heatId`, with `heatId`
    // omitted from the subscription's variables — the tell that asks the
    // backend for whatever the timer manager considers armed or running,
    // rather than for one particular heat.

    it('passes the heat session\'s heatId as activeHeatId to the Schedule view', async () => {
        (useSubscription as any).mockImplementation((opts: any) => {
            if (opts.variables && 'trackId' in opts.variables) {
                return [{ data: { heatSession: { trackId: 1, heatId: 9, phase: 'RUNNING', timerState: 'RUNNING', lanes: [] } } }, vi.fn()];
            }
            return [{ data: undefined }, vi.fn()];
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
            expect(screen.getByTestId('schedule-active-heat-id')).toHaveTextContent('9');
        });
    });

    it('passes null as activeHeatId when nothing is armed or running', async () => {
        // The default mock (beforeEach) answers with no data, as an unarmed
        // track's subscription does before anything has ever been armed.
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
            expect(screen.getByTestId('schedule-active-heat-id')).toHaveTextContent('none');
        });
    });

    it('subscribes to the heat session with heatId omitted, scoped to the track', async () => {
        const subscribeSpy = vi.fn().mockReturnValue([{ data: undefined }, vi.fn()]);
        (useSubscription as any).mockImplementation(subscribeSpy);

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
            expect(subscribeSpy).toHaveBeenCalledWith(
                expect.objectContaining({ variables: { trackId: 1, heatId: null } })
            );
        });
    });

    it('a saved edit does not hand the DNF lane first place (issue #308)', async () => {
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

        fireEvent.click(screen.getByText('Save Edit With DNF'));

        await waitFor(() => {
             expect(mockUpdateHeatResultMutation).toHaveBeenCalled();
        });

        // The 0.0 lane (a DNF) must be sent with no place, and the real
        // finisher must be first — not the ascending-sort order the raw
        // results arrived in.
        expect(mockUpdateHeatResultMutation).toHaveBeenCalledWith({
            heatId: 1,
            lanes: [
                { lane: 1, racerId: 1, placeholderSlot: null, time: 0, place: null, skipped: false },
                { lane: 2, racerId: 2, placeholderSlot: null, time: 4.2, place: 1, skipped: false },
            ],
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

        // The page now runs two subscriptions — raceStateChanged and (#345)
        // heatSession — so the handler is only captured for the one this test
        // is about, by its distinguishing variable. Otherwise the heatSession
        // call, which passes no handler, overwrites it with undefined.
        (useSubscription as any).mockImplementation(
            (opts: any, handler: (prev: any, data: any) => any) => {
                if (opts.variables?.raceId !== undefined) {
                    capturedHandler = handler;
                }
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

        // The page now runs two subscriptions — raceStateChanged and (#345)
        // heatSession — so the handler is only captured for the one this test
        // is about, by its distinguishing variable. Otherwise the heatSession
        // call, which passes no handler, overwrites it with undefined.
        (useSubscription as any).mockImplementation(
            (opts: any, handler: (prev: any, data: any) => any) => {
                if (opts.variables?.raceId !== undefined) {
                    capturedHandler = handler;
                }
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

    // -----------------------------------------------------------------
    // A route to race settings (#589)
    // -----------------------------------------------------------------
    //
    // Race Control had no way to reach the race's own settings at all —
    // only the Roster page's "Edit Details" button did. This sends the
    // operator to the Roster page with the same `?edit=true` Home's row
    // action uses, rather than a `/settings` route the edit form has never
    // had.

    it('offers a route to the race settings the roster page already edits', async () => {
        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                        <Route path="/race/:raceId" element={<div data-testid="landed-on-roster">roster</div>} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        const editButton = await screen.findByTestId('race-control-edit-race');
        fireEvent.click(editButton);

        await waitFor(() => {
            expect(screen.getByTestId('landed-on-roster')).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------
    // Hand-picking a championship round's field (#711)
    // -----------------------------------------------------------------
    //
    // ScheduleManagement itself is mocked above (its own tests cover the
    // badge, the buttons and the picker rendering); these pin RaceControl's
    // side — extracting the created round's id from `createRound`'s array
    // return, waiting for it to show up in the refetched race data before
    // opening the picker, and the pin/unpin mutation handlers.

    const renderControl = async () => {
        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );
        await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    };

    it('opens the picker once a round created with "pick by hand" appears in the race data', async () => {
        // Simulating the round already having arrived by the refetch that
        // follows `createRound` — which is what the render-time sync this
        // test pins actually waits for, rather than opening on the
        // mutation's own response.
        withRounds([
            { id: 55, roundNumber: 2, name: 'Finals', advancementSource: 'ALL', advancementStatus: advancementStatus() },
        ]);
        const mockCreateRound = vi.fn().mockResolvedValue({ data: { createRound: [{ id: 55 }] } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockCreateRound]);

        await renderControl();
        expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('none');

        fireEvent.click(screen.getByText('Add Championship Round (pick by hand)'));

        await waitFor(() => expect(mockCreateRound).toHaveBeenCalled());
        await waitFor(() =>
            expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('55')
        );
    });

    it('never opens the picker for an ordinary round — nothing to pick by hand was asked for', async () => {
        withRounds([
            { id: 55, roundNumber: 2, name: 'Finals', advancementSource: 'ALL', advancementStatus: advancementStatus() },
        ]);
        const mockCreateRound = vi.fn().mockResolvedValue({ data: { createRound: [{ id: 55 }] } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockCreateRound]);

        await renderControl();
        fireEvent.click(screen.getByText('Add General Round'));

        await waitFor(() => expect(mockCreateRound).toHaveBeenCalled());
        expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('none');
    });

    it('stays waiting while the created round has not shown up in the race data yet', async () => {
        // No round 55 in this race's data at all — the mutation resolved,
        // but the refetch it triggers has not (or never will, in this
        // fixture); the picker must not open on stale hope.
        withRounds([]);
        const mockCreateRound = vi.fn().mockResolvedValue({ data: { createRound: [{ id: 55 }] } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockCreateRound]);

        await renderControl();
        fireEvent.click(screen.getByText('Add Championship Round (pick by hand)'));

        await waitFor(() => expect(mockCreateRound).toHaveBeenCalled());
        expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('none');
    });

    it('the schedule\'s own "Pick by hand" button opens the picker directly, and "Close picker" closes it', async () => {
        await renderControl();

        fireEvent.click(screen.getByText('Pick by hand'));
        expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('7');

        fireEvent.click(screen.getByText('Close picker'));
        expect(screen.getByTestId('hand-pick-round-id')).toHaveTextContent('none');
    });

    it('saving a line-up calls pinRoundField and shows a success toast', async () => {
        const mockPinRoundField = vi.fn().mockResolvedValue({ data: { pinRoundField: { id: 7 } } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockPinRoundField]);

        await renderControl();
        fireEvent.click(screen.getByText('Save line-up'));

        await waitFor(() =>
            expect(mockPinRoundField).toHaveBeenCalledWith({ raceId: 1, roundId: 7, racerIds: [101, 102] })
        );
        await waitFor(() => expect(screen.getByText('Line-up saved.')).toBeInTheDocument());
    });

    it('a failed save shows the server\'s reason rather than closing silently', async () => {
        const mockPinRoundField = vi.fn().mockResolvedValue({ error: new Error('This round has already been raced.') });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockPinRoundField]);

        await renderControl();
        fireEvent.click(screen.getByText('Save line-up'));

        await waitFor(() => {
            expect(screen.getByText('This round has already been raced.')).toBeInTheDocument();
        });
    });

    it('using the standings again asks first, then calls unpinRoundField once confirmed', async () => {
        const mockUnpinRoundField = vi.fn().mockResolvedValue({ data: { unpinRoundField: { id: 7 } } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockUnpinRoundField]);

        await renderControl();
        fireEvent.click(screen.getByText('Use standings'));

        // The confirm dialog carries its own button of the same name —
        // the trigger's is the first, the dialog's own is the one that
        // actually confirms.
        const confirmButtons = await screen.findAllByRole('button', { name: 'Use standings' });
        expect(confirmButtons).toHaveLength(2);
        expect(mockUnpinRoundField).not.toHaveBeenCalled();

        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() =>
            expect(mockUnpinRoundField).toHaveBeenCalledWith({ raceId: 1, roundId: 7 })
        );
        await waitFor(() =>
            expect(screen.getByText('Line-up handed back to the standings.')).toBeInTheDocument()
        );
    });

    it('declining the confirmation leaves the pin in place', async () => {
        const mockUnpinRoundField = vi.fn().mockResolvedValue({ data: { unpinRoundField: { id: 7 } } });
        (useMutation as any).mockReturnValue([{ fetching: false }, mockUnpinRoundField]);

        await renderControl();
        fireEvent.click(screen.getByText('Use standings'));

        const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelButton);

        expect(mockUnpinRoundField).not.toHaveBeenCalled();
    });

    it('passes checked-in racer count to ScheduleManagement, excluding racers who are not checked in (#784)', async () => {
        const raceWithPartialCheckIn = {
            race: {
                ...mockRaceData.race,
                racers: [
                    { id: 101, firstName: 'A', lastName: 'B', carNumber: 101, carPassedInspection: true },
                    { id: 102, firstName: 'C', lastName: 'D', carNumber: 102, carPassedInspection: false },
                    { id: 103, firstName: 'E', lastName: 'F', carNumber: 103, carPassedInspection: true },
                ],
            },
        };
        (useQuery as any).mockReturnValue([
            { data: raceWithPartialCheckIn, fetching: false, error: null },
            vi.fn(),
        ]);

        render(
            <AlertProvider>
                <MemoryRouter initialEntries={[`/race/${mockRaceId}/control/schedule`]}>
                    <Routes>
                        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
                    </Routes>
                </MemoryRouter>
            </AlertProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('schedule-management')).toBeInTheDocument();
        });

        // 3 racers on roster, but only 2 checked in (carPassedInspection: true).
        // ScheduleManagement (and in turn RoundWizard / RoundConfigModal) must receive 2,
        // not the total roster length of 3 (#784).
        expect(screen.getByTestId('racer-count-prop')).toHaveTextContent('2');
    });
});

