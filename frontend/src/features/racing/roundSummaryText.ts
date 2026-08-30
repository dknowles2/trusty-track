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
