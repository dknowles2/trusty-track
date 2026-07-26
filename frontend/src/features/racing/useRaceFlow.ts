/**
 * The race-day machine, connected to React (#13).
 *
 * Everything that decides anything lives in `raceFlow.ts` and is tested
 * without rendering. This file is the wiring: it feeds observations in, runs
 * the clock, and performs the commands that come back. It deliberately holds
 * no rules — if you find yourself adding an `if` here about what the race is
 * doing, it belongs in the reducer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    cancelCountdown,
    dismissSummary,
    initialFlowState,
    observe,
    reduce,
    tick,
    type FlowEvent,
    type FlowState,
    type Observation,
    type Screen,
} from './raceFlow';

interface RaceFlowHandlers {
    /** Arm the timer for this heat. */
    onPrepareHeat: (heatId: number) => void;
    /** Move on to the next heat. */
    onAdvance: () => void;
}

export interface RaceFlow {
    /** What the operator is looking at. */
    readonly screen: Screen;
    /** Seconds left, or `null` when no countdown is running. */
    readonly countdown: number | null;
    /** The round whose summary is up, or `null`. */
    readonly summaryRoundId: number | null;
    /** Close the summary. Releases any countdown it was suppressing. */
    readonly dismissSummary: () => void;
    /** Call off the countdown, stickily, for the heat on screen. */
    readonly cancelCountdown: () => void;
}

export function useRaceFlow(observation: Observation, handlers: RaceFlowHandlers): RaceFlow {
    const stateRef = useRef<FlowState>(initialFlowState);
    const [screen, setScreen] = useState<Screen>(initialFlowState.screen);

    // Held in a ref so that a fresh callback identity on the parent's every
    // render does not re-fire anything. This is what `onNextHeatRef` was for,
    // now in the one place that needs it rather than in the component.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    const dispatch = useCallback((event: FlowEvent) => {
        const { state, commands } = reduce(stateRef.current, event);
        stateRef.current = state;
        // `settle` preserves object identity when nothing changed, so this is
        // a no-op render-wise on the great majority of server payloads.
        setScreen(state.screen);
        for (const command of commands) {
            switch (command.type) {
                case 'PREPARE_HEAT':
                    handlersRef.current.onPrepareHeat(command.heatId);
                    break;
                case 'ADVANCE_TO_NEXT_HEAT':
                    handlersRef.current.onAdvance();
                    break;
            }
        }
    }, []);

    // One observation per actual change. Destructured so the dependency list is
    // primitives — an unchanged server payload arriving as a new object must
    // not count as news. That identity problem is what the
    // `eslint-disable react-hooks/exhaustive-deps` on the old round-summary
    // effect was working around.
    const {
        heatId,
        phase,
        timerState,
        hasRecordedTimes,
        hasNextHeat,
        autoAdvanceEnabled,
        hasRoundSummary,
        roundSummaryId,
    } = observation;
    useEffect(() => {
        dispatch(
            observe({
                heatId,
                phase,
                timerState,
                hasRecordedTimes,
                hasNextHeat,
                autoAdvanceEnabled,
                hasRoundSummary,
                roundSummaryId,
            }),
        );
    }, [
        dispatch,
        heatId,
        phase,
        timerState,
        hasRecordedTimes,
        hasNextHeat,
        autoAdvanceEnabled,
        hasRoundSummary,
        roundSummaryId,
    ]);

    // The clock. Keyed on `kind`, not on the whole screen, so counting from 10
    // to 1 does not tear down and rebuild the interval nine times.
    const counting = screen.kind === 'COUNTING_DOWN';
    useEffect(() => {
        if (!counting) return;
        const interval = setInterval(() => dispatch(tick()), 1000);
        return () => clearInterval(interval);
    }, [counting, dispatch]);

    return {
        screen,
        countdown: screen.kind === 'COUNTING_DOWN' ? screen.secondsLeft : null,
        summaryRoundId: screen.kind === 'ROUND_SUMMARY' ? screen.roundId : null,
        dismissSummary: useCallback(() => dispatch(dismissSummary()), [dispatch]),
        cancelCountdown: useCallback(() => dispatch(cancelCountdown()), [dispatch]),
    };
}
