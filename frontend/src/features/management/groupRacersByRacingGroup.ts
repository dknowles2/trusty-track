/**
 * Grouping the roster by racing group for the "group by racing group" view (#437).
 *
 * The desktop table and the mobile cards each built this — an identical
 * `reduce` into buckets, then a sort putting the unassigned bucket last and
 * ordering the rest by racing group name — copied rather than shared, and
 * with no direct test of either copy. `rosterSort.ts` and `rosterStatus.ts`
 * are where a roster rule like this belongs.
 *
 * Pure. No React, no urql — the one word it needs for the "nothing resolves"
 * fallback below is passed in rather than read from `useTerminology()`
 * (#496 stage 4).
 */

export interface GroupableRacer {
    id: number;
    racing_group_id?: number;
}

export interface GroupableRacingGroup {
    id: number;
    name: string;
    color: string;
}

/** A racer with no racing group buckets under this id — not a real racing
 * group's, so it can never collide with one. */
export const UNASSIGNED_RACING_GROUP_ID = -1;

export interface RosterBucket<T> {
    racingGroupId: number;
    /** "Unassigned" for the unassigned bucket; the racing group's own name
     * otherwise, falling back to "Unknown Racing Group" for a racing group id
     * nothing here resolves — reachable when a racing group is deleted out
     * from under a racer still holding its id. */
    racingGroupName: string;
    racingGroupColor: string;
    items: T[];
}

/**
 * The roster split into one bucket per racing group, unassigned racers in a
 * bucket of their own.
 *
 * Buckets are ordered by racing group name, unassigned last — that bucket is
 * the one still needing a decision, which is easier to spot at the end of a
 * list than in the middle of one, the same reasoning `sortRacers` gives car
 * number. Within a bucket, racers keep the order they arrived in; sort them
 * first if an order is wanted.
 */
export function groupRacersByRacingGroup<T extends GroupableRacer>(
    racers: readonly T[],
    racingGroups: readonly GroupableRacingGroup[],
    /** The singular racing-group word, for the "id nothing resolves" fallback
     * below. Defaults to the built-in Scouting word, mirroring
     * `DEFAULT_TERMINOLOGY` — a caller that has not been threaded through
     * `useTerminology()` still renders what it always did. */
    groupWord = 'Den',
): RosterBucket<T>[] {
    const racingGroupMap = new Map(racingGroups.map((racingGroup) => [racingGroup.id, racingGroup]));

    const buckets = new Map<number, T[]>();
    racers.forEach((racer) => {
        const racingGroupId = racer.racing_group_id || UNASSIGNED_RACING_GROUP_ID;
        const bucket = buckets.get(racingGroupId);
        if (bucket) {
            bucket.push(racer);
        } else {
            buckets.set(racingGroupId, [racer]);
        }
    });

    return Array.from(buckets.entries())
        .map(([racingGroupId, items]) => {
            const racingGroup = racingGroupMap.get(racingGroupId);
            return {
                racingGroupId,
                racingGroupName:
                    racingGroupId === UNASSIGNED_RACING_GROUP_ID
                        ? 'Unassigned'
                        : (racingGroup?.name || `Unknown ${groupWord}`),
                racingGroupColor:
                    racingGroupId === UNASSIGNED_RACING_GROUP_ID ? '#eee' : (racingGroup?.color || '#eee'),
                items,
            };
        })
        .sort((a, b) => {
            if (a.racingGroupId === UNASSIGNED_RACING_GROUP_ID) return 1;
            if (b.racingGroupId === UNASSIGNED_RACING_GROUP_ID) return -1;
            // Compared on the raw name, not `racingGroupName` above: an id
            // nothing resolves sorts as the empty string here (first), where
            // its *display* name reads "Unknown Racing Group" — the same
            // split the original two copies both made.
            const nameA = racingGroupMap.get(a.racingGroupId)?.name || '';
            const nameB = racingGroupMap.get(b.racingGroupId)?.name || '';
            return nameA.localeCompare(nameB);
        });
}
