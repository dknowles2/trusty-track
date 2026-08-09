/**
 * Whether a racer on the roster actually has heats to run (#172).
 *
 * A racer who is checked in and in no heat is the state the issue was really
 * about: they are on the roster, they are standing at the track, and nothing
 * on screen says why they are not racing. Admission now handles almost every
 * case by itself — a round nobody has raced is regenerated with them in it,
 * and a round part-way through gets heats appended — so what is left here is
 * the one case that cannot be fixed automatically: they arrived after the
 * round they would have been in was already finished.
 *
 * Pure, and deliberately not a query. "Is this racer in a heat" is answered by
 * `scheduledRacerIds`, which the roster already asks for.
 */

export type RosterStatus =
    | 'NOT_CHECKED_IN'
    | 'RACING'
    | 'NOT_IN_ANY_HEAT';

/**
 * `anyHeatsScheduled` is what stops this shouting before the event starts.
 *
 * Nobody is in a heat until the first round is generated, so without it every
 * racer on a fresh roster is flagged as left out — which is both wrong and the
 * fastest way to teach an operator to ignore the badge.
 */
export function rosterStatus(
    racer: { carPassedInspection: boolean; id: number },
    scheduledRacerIds: readonly number[],
    anyHeatsScheduled: boolean,
): RosterStatus {
    if (!racer.carPassedInspection) return 'NOT_CHECKED_IN';
    if (!anyHeatsScheduled) return 'RACING';
    return scheduledRacerIds.includes(racer.id) ? 'RACING' : 'NOT_IN_ANY_HEAT';
}

/** What to tell the operator, in the roster, about a racer with no heats. */
export function statusNotice(status: RosterStatus): string | null {
    if (status !== 'NOT_IN_ANY_HEAT') return null;
    return 'Not in any heat — they arrived after this round finished. They will be in the next round you generate.';
}

/** The short form, for the badge itself. */
export function statusLabel(status: RosterStatus): string | null {
    return status === 'NOT_IN_ANY_HEAT' ? 'No heats' : null;
}
