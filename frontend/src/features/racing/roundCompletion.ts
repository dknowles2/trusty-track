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

/** The shape of a round this module needs. A view of the GraphQL type. */
export interface DecidableRound {
    readonly id: number;
    /** The round's *own* source, null for a general round. */
    readonly advancementSource?: string | null;
    readonly advancementStatus: {
        readonly isReady: boolean;
        readonly alreadyAdvanced: boolean;
    };
}

/**
 * Which rounds currently have a decided field.
 *
 * The condition that is easy to get wrong is the first one. `advancementStatus.
 * requiresAdvancement` is *also* true for a general round — the server borrows
 * it from whichever championship round follows, so the panel can show who is on
 * track to advance — and the other two are vacuous for a general round, which
 * has no placeholders to resolve and, if it is round one, no earlier round to
 * finish. Filtering on it meant a schedule appearing counted as a round being
 * decided, and an operator who generated one with Race Control already open got
 * "Round Complete!" over an unraced race with everyone on 0.000 (#114).
 *
 * The round's own `advancementSource` is the question actually being asked:
 * does this round draw its field from somewhere, and has that field arrived?
 */
export function decidedRoundIds(rounds: readonly DecidableRound[]): number[] {
    return rounds
        .filter((r) => r.advancementSource && r.advancementStatus.isReady && r.advancementStatus.alreadyAdvanced)
        .map((r) => r.id);
}
