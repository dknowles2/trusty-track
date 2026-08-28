/**
 * Grouping the roster by den for the "group by den" view (#437).
 *
 * The desktop table and the mobile cards each built this — an identical
 * `reduce` into buckets, then a sort putting the unassigned bucket last and
 * ordering the rest by den name — copied rather than shared, and with no
 * direct test of either copy. `rosterSort.ts` and `rosterStatus.ts` are where
 * a roster rule like this belongs.
 *
 * Pure. No React, no urql.
 */

export interface GroupableRacer {
    id: number;
    den_id?: number;
}

export interface GroupableDen {
    id: number;
    name: string;
    color: string;
}

/** A racer with no den groups under this id — not a real den's, so it can
 * never collide with one. */
export const UNASSIGNED_DEN_ID = -1;

export interface DenGroup<T> {
    denId: number;
    /** "Unassigned" for the unassigned group; the den's own name otherwise,
     * falling back to "Unknown Den" for a den id nothing here resolves —
     * reachable when a den is deleted out from under a racer still holding
     * its id. */
    denName: string;
    denColor: string;
    items: T[];
}

/**
 * The roster split into one group per den, unassigned racers in a group of
 * their own.
 *
 * Groups are ordered by den name, unassigned last — that group is the one
 * still needing a decision, which is easier to spot at the end of a list than
 * in the middle of one, the same reasoning `sortRacers` gives car number.
 * Within a group, racers keep the order they arrived in; sort them first if
 * an order is wanted.
 */
export function groupRacersByDen<T extends GroupableRacer>(
    racers: readonly T[],
    dens: readonly GroupableDen[],
): DenGroup<T>[] {
    const denMap = new Map(dens.map((den) => [den.id, den]));

    const buckets = new Map<number, T[]>();
    racers.forEach((racer) => {
        const denId = racer.den_id || UNASSIGNED_DEN_ID;
        const bucket = buckets.get(denId);
        if (bucket) {
            bucket.push(racer);
        } else {
            buckets.set(denId, [racer]);
        }
    });

    return Array.from(buckets.entries())
        .map(([denId, items]) => {
            const den = denMap.get(denId);
            return {
                denId,
                denName: denId === UNASSIGNED_DEN_ID ? 'Unassigned' : (den?.name || 'Unknown Den'),
                denColor: denId === UNASSIGNED_DEN_ID ? '#eee' : (den?.color || '#eee'),
                items,
            };
        })
        .sort((a, b) => {
            if (a.denId === UNASSIGNED_DEN_ID) return 1;
            if (b.denId === UNASSIGNED_DEN_ID) return -1;
            // Compared on the raw name, not `denName` above: an id nothing
            // resolves sorts as the empty string here (first), where its
            // *display* name reads "Unknown Den" — the same split the
            // original two copies both made.
            const nameA = denMap.get(a.denId)?.name || '';
            const nameB = denMap.get(b.denId)?.name || '';
            return nameA.localeCompare(nameB);
        });
}
