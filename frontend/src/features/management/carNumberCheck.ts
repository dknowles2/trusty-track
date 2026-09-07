/**
 * Whether a typed car number is already held by another racer in the race
 * (#811, follow-up to #741/#810 — see #810 for the part of #741 already
 * fixed server-side, refusing an *overlapping racing-group range*).
 *
 * A racer's own duplicate number is different: `.claude/rules/roster.md`
 * is explicit that `MANUAL` numbering deliberately allows two racers to
 * share a number — the check-in scanner's manual-entry box only resolves
 * when exactly one racer holds the number, precisely *because* duplicates
 * are legitimate there. So this is a warning, never a refusal, shown while
 * the operator is typing — the same shape `weightCheck.ts` uses for an
 * overweight car (#205): the save is not blocked, the human decides, and
 * the app only makes the collision visible at the moment it matters. It
 * applies under any numbering strategy, `GLOBAL`/`PER_GROUP` included,
 * since an operator can always type an explicit number over the auto-fill.
 *
 * Pure, so `RacerForm.tsx` computes it fresh on every keystroke with no
 * network round trip — the roster page already has every racer's number in
 * memory (`GET_RACE_DETAILS`), which is what `existingRacers` is threaded
 * down from.
 */

export interface CarNumberHolder {
    id: number;
    car_number?: number | null;
    first_name: string;
    last_name: string;
}

/**
 * The names already holding `carNumber`, or `null` when nobody does (or
 * nothing has been typed yet). `excludeRacerId` is the racer being edited,
 * if any — their own unchanged number must not warn about itself.
 */
export function duplicateCarNumberNotice(
    carNumber: number | undefined,
    racers: readonly CarNumberHolder[],
    excludeRacerId?: number,
): string | null {
    if (carNumber == null) return null;
    const holders = racers.filter(
        (r) => r.car_number === carNumber && r.id !== excludeRacerId,
    );
    if (holders.length === 0) return null;
    const names = holders.map((r) => `${r.first_name} ${r.last_name}`).join(', ');
    return `Number ${carNumber} is already used by ${names}.`;
}
