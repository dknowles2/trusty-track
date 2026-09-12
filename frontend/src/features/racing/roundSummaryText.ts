/**
 * Naming where a round's field came from, for the "Round Complete!" summary
 * (#532).
 *
 * `AdvancementStatus.source` carries the server's own vocabulary — `ALL`,
 * `EACH_GROUP`, or `ROUND:<id>` — and none of those three are what an
 * operator should read off a projector. This used to be hardcoded as "the
 * whole pack" / "each racing group" / "an earlier round", which was wrong in
 * both directions at once: an install that renamed "Pack" said "pack" anyway,
 * and an install that renamed nothing was told "racing group" — the
 * *internal* name for the concept, not the word the rest of the app uses for
 * it ("Den" by default). `RoundWizard.tsx` already phrases the `EACH_GROUP`
 * case correctly ("from each ${groupLower}"); this is the same rule, pulled
 * out so `RaceExecution.tsx`'s summary modal can share it rather than carry
 * its own copy that drifts.
 *
 * Pure, and takes the resolved words as a parameter rather than importing
 * `useTerminology()` itself — the same split as `awardText.ts`.
 */

export interface AdvancingFromWords {
    /** The organization's lowercase singular word — "pack" by default. */
    orgLower: string;
    /** The racing group's lowercase singular word — "den" by default. */
    groupLower: string;
}

/** "the whole pack", "each den", or "an earlier round". */
export function advancingFromLabel(
    source: string | null | undefined,
    { orgLower, groupLower }: AdvancingFromWords,
): string {
    if (source === 'ALL') return `the whole ${orgLower}`;
    if (source === 'EACH_GROUP') return `each ${groupLower}`;
    // A `ROUND:<id>` source, or (defensively) anything else the server might
    // one day send — the round's own name is not worth threading through
    // for a case an operator reads as "some earlier round" either way.
    return 'an earlier round';
}

/**
 * The Round Complete!/Race Complete! summaries' line about a heat that was
 * skipped and never re-run (#1001). Neither dialog used to say anything
 * about one: the round summary offered no way back to it, and the race
 * summary's "Every heat has been run" was simply false for a race holding
 * a skip — a skip is a legitimate way for a heat to finish (see
 * `.claude/rules/heat-lanes.md`'s `is_finished`), but it is not a *result*,
 * and an operator who sees the cars turn up after all needs a way back.
 *
 * `repicks` names the one thing the round summary can say that the race
 * summary cannot: skipping a heat still records something (last place, or
 * an excluded round, depending on scoring — see `.claude/rules/scoring.md`),
 * so the advancement cascade already ran once without this heat's real
 * result, and running it for real later re-runs that cascade. The race
 * summary has no specific "next round" to name, so it drops the clause
 * rather than gesturing at one.
 *
 * Takes the resolved vehicle word rather than importing `useTerminology()`
 * itself, the same split every other pure helper in this file uses.
 */
export function skippedHeatWarning(
    heatNumber: number,
    vehiclesLower: string,
    repicks: boolean,
): string {
    const suffix = repicks ? ' — the next round will re-pick.' : '.';
    return `Heat ${heatNumber} was skipped. Run it first if the ${vehiclesLower} have turned up${suffix}`;
}
