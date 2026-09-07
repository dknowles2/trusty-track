/**
 * Noticing that the whole race has just finished (#847).
 *
 * The same shape as `roundCompletion.ts`, and for the same reason: there is
 * no event for "every heat that will ever run has now run," so it is
 * recovered by comparing this look's answer against the last. `seen === null`
 * means the first look, which is history rather than news — a race that
 * finished before this screen opened must not throw up a celebration on
 * load. Where `roundCompletion.ts` carries a *set* of decided round ids
 * (because several rounds can each have their own summary over a race's
 * life), there is only one race, so the "seen" state here is the single
 * boolean the last look reported rather than a list.
 */

/** What the previous look reported, or `null` before the first one. */
export type SeenComplete = boolean | null;

export interface RaceCompletion {
    /** To carry into the next call. */
    readonly seen: boolean;
    /** True exactly on the call where completion is first observed. */
    readonly justCompleted: boolean;
}

/**
 * @param seen  the `seen` from the previous call, or `null` on the first.
 * @param isComplete  whether every heat the race will ever run has now run.
 */
export function observeRaceComplete(seen: SeenComplete, isComplete: boolean): RaceCompletion {
    if (seen === null) {
        return { seen: isComplete, justCompleted: false };
    }
    // A result cleared on the last heat un-completes the race; carrying
    // forward exactly what is true now is what lets it be news again if the
    // operator finishes it a second time.
    return { seen: isComplete, justCompleted: isComplete && !seen };
}
