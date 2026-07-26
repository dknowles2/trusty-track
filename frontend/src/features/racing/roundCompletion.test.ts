import { describe, test, expect } from 'vitest';
import { observeAdvanced, type SeenRounds } from './roundCompletion';

/** Feed a series of observations through, keeping the running `seen`. */
const sequence = (rounds: number[][]) => {
    let seen: SeenRounds = null;
    const reported: (number | null)[] = [];
    for (const advancedIds of rounds) {
        const result = observeAdvanced(seen, advancedIds);
        seen = result.seen;
        reported.push(result.completedRoundId);
    }
    return reported;
};

describe('noticing a round has been decided', () => {
    test('the first look is history, not news', () => {
        // Opening the screen on a race two rounds in must not greet the
        // operator with a summary for a round finished half an hour ago.
        expect(observeAdvanced(null, [1, 2]).completedRoundId).toBeNull();
    });

    test('the first look still records what it saw', () => {
        expect(observeAdvanced(null, [1, 2]).seen).toEqual([1, 2]);
    });

    test('a round decided after we started is news', () => {
        expect(sequence([[1], [1, 2]])).toEqual([null, 2]);
    });

    test('it is news exactly once', () => {
        expect(sequence([[1], [1, 2], [1, 2], [1, 2]])).toEqual([null, 2, null, null]);
    });

    test('an unchanged poll reports nothing', () => {
        expect(sequence([[1, 2], [1, 2]])).toEqual([null, null]);
    });

    test('nothing decided, nothing reported', () => {
        expect(sequence([[], [], []])).toEqual([null, null, null]);
    });

    test('re-running a heat un-decides a round', () => {
        // A result cleared in round 1 resets the field of round 2, which was
        // drawn from it. `seen` has to forget round 2 or it can never be news
        // again.
        expect(sequence([[1, 2], [1], [1, 2]])).toEqual([null, null, 2]);
    });

    test('un-deciding and re-deciding in one step is still news', () => {
        // The case the old early `return` deferred to a second render: round 2
        // drops out and round 3 appears in the same poll. There is no second
        // render to rely on if the query happens to settle here.
        expect(sequence([[1, 2], [1, 3]])).toEqual([null, 3]);
    });

    test('several rounds deciding at once reports one', () => {
        // Only one modal can be up. The rest are recorded as seen, which is
        // deliberate — the operator is looking at the round they just ran, and
        // a queue of stale summaries would be worse than none.
        const reported = sequence([[1], [1, 2, 3]]);
        expect(reported[1]).not.toBeNull();
        expect([2, 3]).toContain(reported[1]);
    });

    test('and does not report the others afterwards', () => {
        expect(sequence([[1], [1, 2, 3], [1, 2, 3]])[2]).toBeNull();
    });

    test('order does not matter', () => {
        expect(sequence([[1, 2], [2, 1]])).toEqual([null, null]);
    });

    test('the input is not mutated', () => {
        const advancedIds = [1, 2];
        observeAdvanced([1], advancedIds);
        expect(advancedIds).toEqual([1, 2]);
    });

    test('the returned seen is a copy, not the input', () => {
        const advancedIds = [1, 2];
        const { seen } = observeAdvanced([1], advancedIds);
        expect(seen).not.toBe(advancedIds);
    });
});
