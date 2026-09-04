/**
 * Deleting a locked race requires typing its name (#585).
 *
 * A locked race stays deletable — the server never gates `deleteRace` on
 * anything but the operator role, since the PIN is already the credential
 * that matters (see `backend/api/race_lock.py`). This is a purely client-side
 * safeguard against the one click that undoes everything: an event marked
 * "done" is exactly the one an operator is least likely to be reading every
 * word of a confirmation dialog for.
 *
 * Pure, in the tradition of `printables/scanning.ts` and
 * `awards/deleteConfirmation`-shaped helpers elsewhere: the rule is a string
 * comparison, and the component wires it to a modal.
 */

/**
 * Whitespace-trimmed, case-sensitive, otherwise exact. Trimmed because a
 * pasted or autocompleted name can pick up a trailing space nobody meant to
 * type; case-sensitive because "close enough" is exactly the failure this
 * exists to prevent — typing the name is the point, not just recognising it.
 */
export function raceNameConfirmed(typed: string, raceName: string): boolean {
    return typed.trim() === raceName;
}
