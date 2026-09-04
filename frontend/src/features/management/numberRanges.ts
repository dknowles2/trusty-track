/**
 * Which block of car numbers a new racing group is offered.
 *
 * Blocks of a hundred, the next one after the highest any existing group
 * uses: 100–199 for the first group, 200–299 for the next, and so on. A
 * group whose range ends mid-block (150, say) still pushes the next group to
 * the following round hundred, so ranges never overlap and always start on
 * a number a person would pick. Groups with no range at all count for
 * nothing, so an install that numbers cars globally still gets 100–199
 * offered — and can clear it.
 *
 * Extracted from `RacingGroupManager` (#662) so the setup wizard offers a
 * scaffolded group exactly the block Manage Dens would have — one rule, two
 * callers, rather than a second copy free to drift.
 */

export interface NumberRange {
    start: number;
    end: number;
}

/** Only the field this rule reads — structurally a subset of `RacingGroup`. */
export interface HasNumberRange {
    car_number_range_end?: number | null;
}

export function suggestedRange(racingGroups: readonly HasNumberRange[]): NumberRange {
    let maxEnd = 0;
    for (const group of racingGroups) {
        if (group.car_number_range_end && group.car_number_range_end > maxEnd) {
            maxEnd = group.car_number_range_end;
        }
    }
    if (maxEnd === 0) {
        return { start: 100, end: 199 };
    }
    const nextStart = Math.ceil((maxEnd + 1) / 100) * 100;
    return { start: nextStart, end: nextStart + 99 };
}
