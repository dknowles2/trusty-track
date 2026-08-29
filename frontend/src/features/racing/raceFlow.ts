/**
 * What the operator screen does between heats.
 *
 * Issue #13. This was six `useEffect`s in `RaceExecution.tsx` guarding each
 * other with mirror state (`prevIsRunning`), refs (`lastPreparedIdRef`,
 * `wasCompletedRef`), a derived boolean (`shouldResetAutoAdvance`) and an
 * `eslint-disable react-hooks/exhaustive-deps`. The behaviour was emergent from
 * effect ordering, so the only way to test it was to render the component and
 * hope.
 *
 * Not the heat's state
 * --------------------
 * The issue proposed a client machine reading
 * ``IDLE -> PREPARING -> ARMED -> RUNNING -> RECORDING -> RECORDED``. That is
 * the *heat's* state, and since #7 the server owns exactly that and publishes
 * it as `HeatSession.phase`. Rebuilding it here would restore the second source
 * of truth #7 removed, and leave two copies of the vocabulary to drift.
 *
 * So `phase` is an **input** to this machine, not a state of it. What is left
 * is genuinely local: whether a countdown to the next heat is running, and
 * whether a round summary is up. Neither exists on the server, and neither
 * survives a refresh — which is the test for whether something belongs here.
 *
 * Effects are values
 * ------------------
 * {@link reduce} returns commands rather than performing them, so "arm the
 * next heat" and "advance" can be asserted in a test that never renders
 * anything. The auto-prepare rule is the one that carried the comment
 * "Tracking for auto-prepare to avoid race conditions"; it is now four lines
 * with a name.
 */
import type { HeatPhase } from '../../gql/operations';

/** Seconds on the auto-advance countdown. Was a bare `10` in two places. */
export const AUTO_ADVANCE_SECONDS = 10;

/**
 * Everything the machine needs to know about the world, as the screen last saw
 * it.
 *
 * All primitives on purpose: the component dispatches {@link observe} from an
 * effect keyed on these fields, so an unchanged server payload with a fresh
 * object identity does not re-fire. That identity problem is what the
 * `eslint-disable` on the round-summary effect was working around.
 */
export interface Observation {
    /** The heat on screen, or `null` when none is selected. */
    readonly heatId: number | null;
    /** The server's answer to "what is this heat doing" (#7). */
    readonly phase: HeatPhase;
    /** The device's state, which is a different question. Gates arming only. */
    readonly timerState: string;
    /**
     * Whether this track has a timer at all (#490).
     *
     * A track configured with no timer refuses `prepareHeat` on the server —
     * there is nothing to arm — so calling it on every observation would be
     * a mutation fired once per render for no reason, forever. This is a
     * plain, already-known fact about the track (`Track.timerType`), not a
     * merge of live timer state: gating on it here is not the client
     * recomputing anything `domain/heat_session.py` owns.
     */
    readonly hasTimer: boolean;
    /** Real times are recorded — not merely skipped. Skips advance at once. */
    readonly hasRecordedTimes: boolean;
    /** There is somewhere to advance *to*. */
    readonly hasNextHeat: boolean;
    /** The race's `autoAdvanceHeat` setting. */
    readonly autoAdvanceEnabled: boolean;
    /**
     * A round's field has just been decided.
     *
     * Separate from {@link roundSummaryId} because `AdvancementStatus.roundId`
     * is optional — it is attached client-side when the summary is raised — so
     * "no summary" and "a summary carrying no id" are different things that a
     * single nullable number cannot tell apart.
     */
    readonly hasRoundSummary: boolean;
    /** Which round that is, when it says. */
    readonly roundSummaryId: number | null;
}

/** What the operator is looking at. Exactly one of these is true. */
export type Screen =
    | { readonly kind: 'WATCHING' }
    | { readonly kind: 'COUNTING_DOWN'; readonly secondsLeft: number }
    | { readonly kind: 'ROUND_SUMMARY'; readonly roundId: number | null };

export interface FlowState {
    /** What renders. */
    readonly screen: Screen;
    /**
     * The last heat we asked the backend to arm. Replaces `lastPreparedIdRef`.
     *
     * Cleared when the heat reaches RECORDED, which is what lets a re-run of
     * the *same* heat arm again — the case `wasCompletedRef` existed for.
     */
    readonly preparedHeatId: number | null;
    /**
     * Whether the summary now on offer has already been raised once. Together
     * with {@link summarisedRoundId} this replaces `lastOpenedRoundId`, and it
     * is why dismissing the modal does not immediately reopen it.
     *
     * The old code compared ids alone, so a summary carrying no `roundId`
     * compared `undefined !== null` forever and re-opened on every render.
     * Harmless in production, where `RaceControl` always attaches one — but it
     * is the kind of thing that only shows up when something else changes.
     */
    readonly haveSummarised: boolean;
    /** Which round that was, when it said. */
    readonly summarisedRoundId: number | null;
    /**
     * The heat whose countdown the operator called off, if any.
     *
     * Cancelling has to be sticky, or the next observation would start it
     * again — nothing about the world changed when the operator clicked. It is
     * scoped to a heat rather than latched forever so that moving on gets a
     * countdown back. The old code got this by accident: the countdown effect
     * was keyed on `shouldResetAutoAdvance`, which cancelling did not alter,
     * so the effect simply never re-ran.
     */
    readonly countdownCancelledFor: number | null;
    /** The last thing we were told. Kept so dismissal can re-decide. */
    readonly observed: Observation | null;
}

/** Something for the component to do. Returned, never performed. */
export type FlowCommand =
    | { readonly type: 'PREPARE_HEAT'; readonly heatId: number }
    | { readonly type: 'ADVANCE_TO_NEXT_HEAT' };

export type FlowEvent =
    | { readonly type: 'OBSERVED'; readonly observation: Observation }
    | { readonly type: 'TICK' }
    | { readonly type: 'SUMMARY_DISMISSED' }
    | { readonly type: 'COUNTDOWN_CANCELLED' };

export interface FlowResult {
    readonly state: FlowState;
    readonly commands: readonly FlowCommand[];
}

export const initialFlowState: FlowState = {
    screen: { kind: 'WATCHING' },
    preparedHeatId: null,
    haveSummarised: false,
    summarisedRoundId: null,
    countdownCancelledFor: null,
    observed: null,
};

/** Convenience constructors, so call sites read as sentences. */
export const observe = (observation: Observation): FlowEvent => ({ type: 'OBSERVED', observation });
export const tick = (): FlowEvent => ({ type: 'TICK' });
export const dismissSummary = (): FlowEvent => ({ type: 'SUMMARY_DISMISSED' });
export const cancelCountdown = (): FlowEvent => ({ type: 'COUNTDOWN_CANCELLED' });

/**
 * Should the countdown to the next heat be running?
 *
 * The old `shouldResetAutoAdvance` inverted, minus its round-summary clause —
 * that is a screen, and a screen cannot be two things at once, so the machine
 * expresses it by structure instead of by condition.
 *
 * `hasRecordedTimes` rather than `phase === 'RECORDED'` is deliberate: a
 * *skipped* heat is RECORDED but holds no times, and skips advance immediately
 * through their own handler rather than sitting behind a ten-second wait.
 */
const shouldCountDown = (observation: Observation): boolean =>
    observation.autoAdvanceEnabled &&
    observation.hasRecordedTimes &&
    observation.hasNextHeat &&
    observation.phase !== 'NOT_READY';

/**
 * The screen a WATCHING-or-counting flow should be on, given what we can see.
 *
 * Shared by `OBSERVED` and `SUMMARY_DISMISSED` so that closing a summary starts
 * the countdown the summary was suppressing — which is what the old code did,
 * by way of `shouldResetAutoAdvance` flipping back.
 */
const settle = (screen: Screen, observation: Observation, cancelledFor: number | null): Screen => {
    if (screen.kind === 'ROUND_SUMMARY') return screen;
    const cancelled = cancelledFor !== null && cancelledFor === observation.heatId;
    if (cancelled || !shouldCountDown(observation)) {
        // Returning the *same* object when nothing changed, not an equal one.
        // React renders on identity, and this runs on every server payload.
        return screen.kind === 'WATCHING' ? screen : { kind: 'WATCHING' };
    }
    // Already counting: leave it alone. Restarting on every observation would
    // mean a heat that keeps re-rendering never advances.
    if (screen.kind === 'COUNTING_DOWN') return screen;
    return { kind: 'COUNTING_DOWN', secondsLeft: AUTO_ADVANCE_SECONDS };
};

const observed = (state: FlowState, observation: Observation): FlowResult => {
    const commands: FlowCommand[] = [];

    // Arm the timer for a heat that is ready to run and not already armed.
    // `timerState` gates this rather than `phase`, because a WAITING heat whose
    // device is already ARMED needs nothing.
    let preparedHeatId = state.preparedHeatId;
    if (observation.phase === 'RECORDED') {
        preparedHeatId = null;
    } else if (
        observation.hasTimer &&
        observation.phase === 'WAITING' &&
        observation.timerState === 'IDLE' &&
        observation.heatId !== null &&
        observation.heatId !== preparedHeatId
    ) {
        commands.push({ type: 'PREPARE_HEAT', heatId: observation.heatId });
        preparedHeatId = observation.heatId;
    }

    // A round's field has just been decided. Raise it once.
    let haveSummarised = state.haveSummarised;
    let summarisedRoundId = state.summarisedRoundId;
    let screen = state.screen;
    if (observation.hasRoundSummary) {
        if (!haveSummarised || observation.roundSummaryId !== summarisedRoundId) {
            haveSummarised = true;
            summarisedRoundId = observation.roundSummaryId;
            screen = { kind: 'ROUND_SUMMARY', roundId: observation.roundSummaryId };
        }
    } else if (haveSummarised) {
        // The round stopped being decided — a result was cleared behind us.
        // Drop the summary and forget it, so completing it again re-raises.
        haveSummarised = false;
        summarisedRoundId = null;
        if (screen.kind === 'ROUND_SUMMARY') screen = { kind: 'WATCHING' };
    }

    // A cancellation only covers the heat it was made against.
    const countdownCancelledFor =
        state.countdownCancelledFor === observation.heatId ? state.countdownCancelledFor : null;

    return {
        state: {
            screen: settle(screen, observation, countdownCancelledFor),
            preparedHeatId,
            haveSummarised,
            summarisedRoundId,
            countdownCancelledFor,
            observed: observation,
        },
        commands,
    };
};

/**
 * The machine. Pure: same state and event, same result, no timers, no fetches.
 */
export function reduce(state: FlowState, event: FlowEvent): FlowResult {
    switch (event.type) {
        case 'OBSERVED':
            return observed(state, event.observation);

        case 'TICK': {
            if (state.screen.kind !== 'COUNTING_DOWN') return { state, commands: [] };
            const secondsLeft = state.screen.secondsLeft - 1;
            if (secondsLeft > 0) {
                return { state: { ...state, screen: { kind: 'COUNTING_DOWN', secondsLeft } }, commands: [] };
            }
            // Reaching zero advances and returns to WATCHING. The next
            // observation of the new heat is what may start a fresh countdown.
            return {
                state: { ...state, screen: { kind: 'WATCHING' } },
                commands: [{ type: 'ADVANCE_TO_NEXT_HEAT' }],
            };
        }

        case 'SUMMARY_DISMISSED': {
            if (state.screen.kind !== 'ROUND_SUMMARY') return { state, commands: [] };
            // `summarisedRoundId` deliberately survives: the operator closed
            // this one, and it should not spring back on the next observation.
            const screen: Screen = { kind: 'WATCHING' };
            return {
                state: {
                    ...state,
                    screen: state.observed
                        ? settle(screen, state.observed, state.countdownCancelledFor)
                        : screen,
                },
                commands: [],
            };
        }

        case 'COUNTDOWN_CANCELLED': {
            if (state.screen.kind !== 'COUNTING_DOWN') return { state, commands: [] };
            return {
                state: {
                    ...state,
                    screen: { kind: 'WATCHING' },
                    countdownCancelledFor: state.observed?.heatId ?? null,
                },
                commands: [],
            };
        }
    }
}
