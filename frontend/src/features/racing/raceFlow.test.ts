/**
 * The race-day flow, tested by dispatching event sequences (#13).
 *
 * None of this renders anything. That is the point: the behaviour these cover
 * used to be emergent from the ordering of six `useEffect`s, and the only way
 * to reach it was through the DOM.
 */
import { describe, test, expect } from 'vitest';
import {
    AUTO_ADVANCE_SECONDS,
    dismissSummary,
    initialFlowState,
    observe,
    reduce,
    tick,
    type FlowEvent,
    type FlowResult,
    type FlowState,
    type Observation,
} from './raceFlow';

/** A heat sitting armed and unraced, with somewhere to go next. */
const seen = (overrides: Partial<Observation> = {}): Observation => ({
    heatId: 1,
    phase: 'WAITING',
    timerState: 'ARMED',
    hasRecordedTimes: false,
    hasNextHeat: true,
    autoAdvanceEnabled: true,
    completedRoundId: null,
    ...overrides,
});

/** Run a sequence from a starting state, keeping the last result. */
const run = (events: FlowEvent[], from: FlowState = initialFlowState): FlowResult =>
    events.reduce<FlowResult>(
        (acc, event) => reduce(acc.state, event),
        { state: from, commands: [] },
    );

/** Every command emitted across a sequence, in order. */
const commandsOf = (events: FlowEvent[], from: FlowState = initialFlowState) => {
    const all: unknown[] = [];
    let state = from;
    for (const event of events) {
        const result = reduce(state, event);
        all.push(...result.commands);
        state = result.state;
    }
    return all;
};

/** A recorded heat with real times — the countdown's precondition. */
const recorded = (overrides: Partial<Observation> = {}) =>
    seen({ phase: 'RECORDED', timerState: 'IDLE', hasRecordedTimes: true, ...overrides });

describe('arming the next heat', () => {
    test('a heat that is ready and unarmed gets prepared', () => {
        expect(commandsOf([observe(seen({ heatId: 7, timerState: 'IDLE' }))])).toEqual([
            { type: 'PREPARE_HEAT', heatId: 7 },
        ]);
    });

    test('a heat the device has already armed is left alone', () => {
        expect(commandsOf([observe(seen({ timerState: 'ARMED' }))])).toEqual([]);
    });

    test('seeing the same heat repeatedly prepares it once', () => {
        const events = [
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
        ];
        expect(commandsOf(events)).toEqual([{ type: 'PREPARE_HEAT', heatId: 7 }]);
    });

    test('moving to a different heat prepares that one', () => {
        const events = [
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
            observe(seen({ heatId: 8, timerState: 'IDLE' })),
        ];
        expect(commandsOf(events)).toEqual([
            { type: 'PREPARE_HEAT', heatId: 7 },
            { type: 'PREPARE_HEAT', heatId: 8 },
        ]);
    });

    test('a heat whose field is undecided is not armed', () => {
        expect(commandsOf([observe(seen({ phase: 'NOT_READY', timerState: 'IDLE' }))])).toEqual([]);
    });

    test('a heat that has already run is not armed', () => {
        expect(commandsOf([observe(recorded())])).toEqual([]);
    });

    test('clearing a result re-arms the same heat', () => {
        // The case `wasCompletedRef` existed for: the id never changes, so an
        // id-only guard would refuse to re-arm and the operator would sit at a
        // dead track. Reaching RECORDED is what forgets the heat.
        const events = [
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
            observe(recorded({ heatId: 7 })),
            observe(seen({ heatId: 7, timerState: 'IDLE' })),
        ];
        expect(commandsOf(events)).toEqual([
            { type: 'PREPARE_HEAT', heatId: 7 },
            { type: 'PREPARE_HEAT', heatId: 7 },
        ]);
    });

    test('no heat selected, nothing to arm', () => {
        expect(commandsOf([observe(seen({ heatId: null, timerState: 'IDLE' }))])).toEqual([]);
    });
});

describe('the auto-advance countdown', () => {
    test('a recorded heat starts it', () => {
        expect(run([observe(recorded())]).state.screen).toEqual({
            kind: 'COUNTING_DOWN',
            secondsLeft: AUTO_ADVANCE_SECONDS,
        });
    });

    test('ticking counts down without advancing', () => {
        const result = run([observe(recorded()), tick(), tick()]);
        expect(result.state.screen).toEqual({ kind: 'COUNTING_DOWN', secondsLeft: 8 });
        expect(result.commands).toEqual([]);
    });

    test('reaching zero advances exactly once', () => {
        const events = [observe(recorded()), ...Array(AUTO_ADVANCE_SECONDS).fill(tick())];
        expect(commandsOf(events)).toEqual([{ type: 'ADVANCE_TO_NEXT_HEAT' }]);
        expect(run(events).state.screen).toEqual({ kind: 'WATCHING' });
    });

    test('ticking past zero does not advance again', () => {
        // A stray timer firing after the countdown finished must not skip a
        // heat. The old code guarded this with a ref it cleared by hand.
        const events = [observe(recorded()), ...Array(AUTO_ADVANCE_SECONDS + 3).fill(tick())];
        expect(commandsOf(events)).toEqual([{ type: 'ADVANCE_TO_NEXT_HEAT' }]);
    });

    test('observing again mid-countdown does not restart it', () => {
        // Re-rendering with the same server data used to be able to reset the
        // clock, so a busy screen would never reach zero.
        const result = run([observe(recorded()), tick(), tick(), observe(recorded())]);
        expect(result.state.screen).toEqual({ kind: 'COUNTING_DOWN', secondsLeft: 8 });
    });

    test('turning auto-advance off stops it', () => {
        const result = run([
            observe(recorded()),
            tick(),
            observe(recorded({ autoAdvanceEnabled: false })),
        ]);
        expect(result.state.screen).toEqual({ kind: 'WATCHING' });
    });

    test('the last heat of a round has nowhere to go', () => {
        expect(run([observe(recorded({ hasNextHeat: false }))]).state.screen).toEqual({
            kind: 'WATCHING',
        });
    });

    test('a skipped heat does not sit behind the countdown', () => {
        // RECORDED but no times: skips advance through their own handler, and
        // making the operator wait ten seconds for a heat nobody ran is worse.
        expect(run([observe(recorded({ hasRecordedTimes: false }))]).state.screen).toEqual({
            kind: 'WATCHING',
        });
    });

    test('a heat with an undecided lane does not count down, even holding times', () => {
        // The only case where `phase !== 'NOT_READY'` and `hasRecordedTimes`
        // disagree, and it is reachable: `resolve_placeholders` leaves a slot
        // alone "when fewer racers advanced than the round has slots", and
        // `domain/heat_session.phase` tests placeholders before results. So a
        // championship heat can hold real times and still be NOT_READY.
        //
        // `RaceExecution` also early-returns "Round Not Ready" before any of
        // this renders, which makes the guard a second line of defence today.
        // Keeping it is the point of #13 — the machine should not be correct
        // only because of where a `return` happens to sit in a render function.
        expect(
            run([observe(recorded({ phase: 'NOT_READY', hasRecordedTimes: true }))]).state.screen,
        ).toEqual({ kind: 'WATCHING' });
    });

    test('clearing the result stops a countdown already running', () => {
        const result = run([
            observe(recorded()),
            tick(),
            observe(seen({ timerState: 'IDLE' })),
        ]);
        expect(result.state.screen).toEqual({ kind: 'WATCHING' });
    });

    test('a fresh countdown starts from the top, not where the last one stopped', () => {
        const result = run([
            observe(recorded({ heatId: 1 })),
            tick(),
            tick(),
            observe(seen({ heatId: 2, timerState: 'IDLE' })),
            observe(recorded({ heatId: 2 })),
        ]);
        expect(result.state.screen).toEqual({
            kind: 'COUNTING_DOWN',
            secondsLeft: AUTO_ADVANCE_SECONDS,
        });
    });
});

describe('the round summary', () => {
    test('a decided round raises it', () => {
        expect(run([observe(recorded({ completedRoundId: 3 }))]).state.screen).toEqual({
            kind: 'ROUND_SUMMARY',
            roundId: 3,
        });
    });

    test('it suppresses the countdown', () => {
        // Both preconditions hold — recorded, times, a next heat — and the
        // summary still wins, because the screen can only be one thing.
        const result = run([observe(recorded({ completedRoundId: 3 }))]);
        expect(result.state.screen.kind).toBe('ROUND_SUMMARY');
    });

    test('a countdown cannot run behind it', () => {
        const events = [observe(recorded({ completedRoundId: 3 })), ...Array(20).fill(tick())];
        expect(commandsOf(events)).toEqual([]);
    });

    test('seeing the same round again does not re-raise it', () => {
        const result = run([
            observe(recorded({ completedRoundId: 3 })),
            dismissSummary(),
            observe(recorded({ completedRoundId: 3 })),
        ]);
        expect(result.state.screen.kind).not.toBe('ROUND_SUMMARY');
    });

    test('dismissing it releases the countdown it was holding', () => {
        // The old code got here by `shouldResetAutoAdvance` flipping back.
        // Keeping the last observation is what lets dismissal re-decide.
        const result = run([observe(recorded({ completedRoundId: 3 })), dismissSummary()]);
        expect(result.state.screen).toEqual({
            kind: 'COUNTING_DOWN',
            secondsLeft: AUTO_ADVANCE_SECONDS,
        });
    });

    test('dismissing with nothing to advance to just watches', () => {
        const result = run([
            observe(recorded({ completedRoundId: 3, hasNextHeat: false })),
            dismissSummary(),
        ]);
        expect(result.state.screen).toEqual({ kind: 'WATCHING' });
    });

    test('a later round raises its own summary', () => {
        const result = run([
            observe(recorded({ completedRoundId: 3 })),
            dismissSummary(),
            observe(recorded({ completedRoundId: 4 })),
        ]);
        expect(result.state.screen).toEqual({ kind: 'ROUND_SUMMARY', roundId: 4 });
    });

    test('undoing a round completion lets it raise again', () => {
        // Re-running the last heat of a round un-decides its field. When the
        // operator finishes it a second time the summary should come back.
        const result = run([
            observe(recorded({ completedRoundId: 3 })),
            dismissSummary(),
            observe(seen({ completedRoundId: null, timerState: 'IDLE' })),
            observe(recorded({ completedRoundId: 3 })),
        ]);
        expect(result.state.screen).toEqual({ kind: 'ROUND_SUMMARY', roundId: 3 });
    });

    test('a round un-deciding while its summary is open closes it', () => {
        const result = run([
            observe(recorded({ completedRoundId: 3 })),
            observe(seen({ completedRoundId: null, timerState: 'IDLE' })),
        ]);
        expect(result.state.screen).toEqual({ kind: 'WATCHING' });
    });

    test('dismissing when no summary is up changes nothing', () => {
        const before = run([observe(recorded())]);
        const after = reduce(before.state, dismissSummary());
        expect(after.state).toEqual(before.state);
        expect(after.commands).toEqual([]);
    });

    test('dismissal before anything was observed is harmless', () => {
        expect(reduce(initialFlowState, dismissSummary()).state).toEqual(initialFlowState);
    });

    test('arming still happens while a summary is up', () => {
        // The summary covers the screen, not the track. The next heat should
        // be armed and waiting when the operator closes it.
        expect(
            commandsOf([observe(seen({ heatId: 9, timerState: 'IDLE', completedRoundId: 3 }))]),
        ).toEqual([{ type: 'PREPARE_HEAT', heatId: 9 }]);
    });
});

describe('the machine cannot re-enter itself', () => {
    test('a tick with nothing counting is a no-op', () => {
        const result = reduce(initialFlowState, tick());
        expect(result.state).toBe(initialFlowState);
        expect(result.commands).toEqual([]);
    });

    test('an unchanged observation emits nothing the second time', () => {
        const first = reduce(initialFlowState, observe(recorded()));
        const second = reduce(first.state, observe(recorded()));
        expect(second.commands).toEqual([]);
        expect(second.state.screen).toEqual(first.state.screen);
    });

    test('a full heat, start to advance', () => {
        const events = [
            observe(seen({ heatId: 1, timerState: 'IDLE' })),
            observe(seen({ heatId: 1, timerState: 'ARMED' })),
            observe(seen({ heatId: 1, phase: 'RUNNING', timerState: 'RUNNING' })),
            observe(recorded({ heatId: 1 })),
            ...Array(AUTO_ADVANCE_SECONDS).fill(tick()),
        ];
        expect(commandsOf(events)).toEqual([
            { type: 'PREPARE_HEAT', heatId: 1 },
            { type: 'ADVANCE_TO_NEXT_HEAT' },
        ]);
    });
});
