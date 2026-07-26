/**
 * Noticing that a round's field has just been decided (#13).
 *
 * There is no event for this. `RaceControl` re-queries the race whenever
 * anything changes, and "a round completed" has to be recovered by comparing
 * one result set against the last — an edge detector written as a `useEffect`
 * over three pieces of state, with an early `return` whose comment read:
 *
 *     // Important: we return here so the next effect run (after state update)
 *     // handles the "newly advanced" case
 *
 * That is the shape of the bug it was working around: the effect could only do
 * one of its two jobs per pass, so noticing a completion depended on a second
 * render arriving. As a function taking the previous answer and returning the
 * next, both jobs happen at once and the `return` has nothing to defer to.
 */

/**
 * What we had seen last time, or `null` before the first look.
 *
 * `null` replaces the separate `advancementInitialized` flag. The distinction
 * matters: on the first look every advanced round is *history*, not news — a
 * round that completed before this screen was opened must not pop a summary at
 * whoever opens it.
 */
export type SeenRounds = readonly number[] | null;

export interface Completion {
    /** To carry into the next call. */
    readonly seen: readonly number[];
    /** The round that just became decided, or `null` for "nothing new". */
    readonly completedRoundId: number | null;
}

/**
 * @param seen  the `seen` from the previous call, or `null` on the first.
 * @param advancedIds  every round currently decided, in any order.
 */
export function observeAdvanced(seen: SeenRounds, advancedIds: readonly number[]): Completion {
    if (seen === null) {
        return { seen: [...advancedIds], completedRoundId: null };
    }

    // Carrying forward exactly what is decided now is what handles a round
    // becoming *un*-decided — re-running the last heat of a round resets the
    // field drawn from it — because such a round simply drops out of `seen`
    // and can be news again next time.
    //
    // The old code did this as an explicit prune before the search, with an
    // early `return` deferring detection to the next render. Both were
    // unnecessary: for any id in `advancedIds`, being in the pruned set is the
    // same as being in `seen`, so the prune cannot change this answer.
    return {
        seen: [...advancedIds],
        completedRoundId: advancedIds.find((id) => !seen.includes(id)) ?? null,
    };
}
