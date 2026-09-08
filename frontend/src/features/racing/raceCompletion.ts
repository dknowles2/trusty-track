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

/**
 * The shape of a round `hasTerminalRound` needs. A view of the GraphQL type.
 */
export interface TerminalCheckRound {
    /** The round's *own* source, null for a general/preliminary round. */
    readonly advancementSource?: string | null;
}

/**
 * Whether the race's *current* schedule already contains a round that could
 * only be a genuine ending (#874) — a round whose field is drawn from
 * another round's standings (`advancementSource` set), which by
 * construction is downstream of every round that fed it.
 *
 * This does **not** gate whether "Race Complete!" fires — it was tried, and
 * reverted. The naive trigger is "every heat that exists has run," the same
 * trap `crud.is_round_complete` is documented to avoid one level down, for
 * exactly the same reason: "between waves everything is finished and
 * nothing is decided." A race built one general round at a time from the
 * **Add Round** dialog has no championship round yet the moment its sole
 * preliminary finishes — every heat that exists has run, and nothing says a
 * final is coming next. Requiring a round like that to exist looked like the
 * fix, until #856's own test raced a wizard-built schedule with *no*
 * championship round at all and expected the summary anyway: a
 * prelims-only race that was always going to end there produces the
 * identical shape — one general round, fully raced, no advancement source —
 * as one that is not done yet. There is no event, and no stored fact, for
 * "the operator does not intend to add another round"; that is a plan in
 * someone's head, not a database row, and the two cases cannot be told apart
 * from what is stored.
 *
 * What this *is* used for is softening the summary's own wording and
 * offering a way out, in `RaceExecution.tsx`'s modal: when the schedule has
 * no such round yet, the copy says "no more heats are currently scheduled"
 * rather than presenting the race as finished, and offers a link to add a
 * championship round alongside the standings/awards/print links that always
 * apply. The modal still shows either way — silence would be exactly as
 * wrong for the race that really is done after its one and only round.
 */
export function hasTerminalRound(rounds: readonly TerminalCheckRound[]): boolean {
    return rounds.some((r) => r.advancementSource != null);
}

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
