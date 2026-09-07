import { describe, test, expect } from 'vitest';
import { observeRaceComplete, type SeenComplete } from './raceCompletion';

/** Feed a series of observations through, keeping the running `seen`. */
const sequence = (looks: boolean[]) => {
    let seen: SeenComplete = null;
    const reported: boolean[] = [];
    for (const isComplete of looks) {
        const result = observeRaceComplete(seen, isComplete);
        seen = result.seen;
        reported.push(result.justCompleted);
    }
    return reported;
};

describe('noticing the whole race has finished', () => {
    test('the first look is history, not news, even when already complete', () => {
        // Opening the screen on a race finished half an hour ago must not
        // greet the operator with a celebration.
        expect(observeRaceComplete(null, true).justCompleted).toBe(false);
    });

    test('the first look still records what it saw', () => {
        expect(observeRaceComplete(null, true).seen).toBe(true);
        expect(observeRaceComplete(null, false).seen).toBe(false);
    });

    test('completing after we started is news', () => {
        expect(sequence([false, true])).toEqual([false, true]);
    });

    test('it is news exactly once', () => {
        expect(sequence([false, true, true, true])).toEqual([false, true, false, false]);
    });

    test('an unchanged poll reports nothing', () => {
        expect(sequence([true, true])).toEqual([false, false]);
    });

    test('never completing never reports', () => {
        expect(sequence([false, false, false])).toEqual([false, false, false]);
    });

    test('re-running the last heat un-completes the race, and finishing it again is news', () => {
        expect(sequence([true, false, true])).toEqual([false, false, true]);
    });
});
