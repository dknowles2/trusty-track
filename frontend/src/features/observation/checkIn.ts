/**
 * How far check-in has got, grouped by racing group, for the `CHECKIN`
 * audience display view (#612).
 *
 * The operator's own roster already answers "who is still missing" —
 * `features/management/components/CheckInProgress.tsx` puts the running
 * count beside the heading, and `car_passed_inspection` (exposed as
 * `carPassedInspection`) is the field that means "checked in" throughout
 * the app (see `CLAUDE.md`'s "A racer who arrives after the racing has
 * started" section). Nobody in the room can see that screen, though — it is
 * behind the check-in desk's own PIN, on one laptop. This module answers the
 * same question for a screen on the wall: not "am I done with my queue" but
 * "which den, and which car, still needs to visit the scale".
 *
 * Pure — no React, no urql — the same split `raceFlow.ts` and
 * `standingsScroll.ts` use between the rule and the component that renders
 * it. `groupRacersByRacingGroup` already does the bucketing the roster's own
 * "group by racing group" view uses; this reuses it rather than writing a
 * second grouping rule that could disagree with the roster's about which
 * bucket a racer with no racing group lands in.
 */

import {
    groupRacersByRacingGroup,
    UNASSIGNED_RACING_GROUP_ID,
    type GroupableRacingGroup,
} from '../management/groupRacersByRacingGroup';

export interface CheckInRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | null;
    carPassedInspection: boolean;
    racingGroupId?: number | null;
}

export interface CheckInGroupSummary {
    racingGroupId: number;
    racingGroupName: string;
    racingGroupColor: string;
    checkedIn: number;
    total: number;
    /** Every racer in this group still to check in, car number ascending —
     * unnumbered last, the same order `inPrintOrder` gives the pit-pass sheet,
     * for the same reason: they are the ones still needing a number, easiest
     * to spot at the bottom of a list than buried in the middle of one. */
    missing: readonly CheckInRacer[];
    /** Every racer in this group already through, same order — for the
     * "list everybody" mode; the "pending only" mode never reads this. */
    checkedInRacers: readonly CheckInRacer[];
    allCheckedIn: boolean;
}

export interface CheckInSummary {
    groups: readonly CheckInGroupSummary[];
    checkedIn: number;
    total: number;
    allCheckedIn: boolean;
}

function byCarNumberThenName(a: CheckInRacer, b: CheckInRacer): number {
    if (a.carNumber == null && b.carNumber == null) {
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    }
    if (a.carNumber == null) return 1;
    if (b.carNumber == null) return -1;
    return a.carNumber - b.carNumber;
}

/**
 * The roster split into per-racing-group check-in progress.
 *
 * `total === 0` is "check-in has not opened" — nothing has been registered
 * yet, or the query is still loading — and the view's job is to say that
 * plainly rather than render a grid of empty groups. `allCheckedIn` (every
 * registered racer through) is the finished state: everybody who is coming
 * has arrived. Everything between is ordinary progress, one card per group.
 */
export function summarizeCheckIn(
    racers: readonly CheckInRacer[],
    racingGroups: readonly GroupableRacingGroup[],
    groupWord = 'Den',
): CheckInSummary {
    const buckets = groupRacersByRacingGroup(
        racers.map((racer) => ({ ...racer, racing_group_id: racer.racingGroupId ?? undefined })),
        racingGroups,
        groupWord,
    );

    const groups: CheckInGroupSummary[] = buckets.map((bucket) => {
        const missing = bucket.items
            .filter((racer) => !racer.carPassedInspection)
            .slice()
            .sort(byCarNumberThenName);
        const checkedInRacers = bucket.items
            .filter((racer) => racer.carPassedInspection)
            .slice()
            .sort(byCarNumberThenName);
        return {
            racingGroupId: bucket.racingGroupId,
            racingGroupName: bucket.racingGroupName,
            racingGroupColor: bucket.racingGroupColor,
            checkedIn: checkedInRacers.length,
            total: bucket.items.length,
            missing,
            checkedInRacers,
            allCheckedIn: missing.length === 0,
        };
    });

    const checkedIn = racers.filter((racer) => racer.carPassedInspection).length;

    return {
        groups,
        checkedIn,
        total: racers.length,
        allCheckedIn: racers.length > 0 && checkedIn === racers.length,
    };
}

export { UNASSIGNED_RACING_GROUP_ID };
