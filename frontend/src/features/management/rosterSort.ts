/**
 * Putting the roster in an order somebody asked for (#203).
 *
 * The table arrived in whatever order the API returned, which is insertion
 * order — arbitrary to everyone except the person who typed it in. The docs
 * audit found a "click a column header to sort" tip written for a table that
 * had never supported it, which is a fair sign of what people expected.
 *
 * Pure. No React, no urql.
 */

export type SortKey = 'car_number' | 'first_name' | 'last_name' | 'den' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
    key: SortKey;
    direction: SortDirection;
}

/**
 * Car number ascending, and it is the default.
 *
 * Same rule as `inPrintOrder` in the printables — unnumbered racers last,
 * because they are the ones still needing a number and that is easier to spot
 * at the end of a list than in the middle of one.
 */
export const DEFAULT_SORT: SortState = { key: 'car_number', direction: 'asc' };

export interface SortableRacer {
    id: number;
    first_name: string;
    last_name: string;
    car_number?: number | null;
    den_id?: number | null;
    car_passed_inspection: boolean;
}

export interface SortableDen {
    id: number;
    name: string;
}

/**
 * What clicking a header should do.
 *
 * A new column starts ascending; the column already sorted flips. There is
 * deliberately no third "unsorted" state to cycle through — the roster has to
 * be in *some* order, so "unsorted" would mean "back to insertion order", which
 * is the arbitrary one this replaced.
 */
export function nextSortState(current: SortState, key: SortKey): SortState {
    if (current.key !== key) return { key, direction: 'asc' };
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

const UNNUMBERED = Number.MAX_SAFE_INTEGER;

function compare(
    a: SortableRacer,
    b: SortableRacer,
    key: SortKey,
    denNames: Map<number, string>,
): number {
    switch (key) {
        case 'car_number': {
            const an = a.car_number ?? UNNUMBERED;
            const bn = b.car_number ?? UNNUMBERED;
            return an - bn;
        }
        case 'first_name':
            return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
        case 'last_name':
            // The table has a column each, so there is a key each — a single
            // "name" key would sort by one of them and label the other.
            return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
        case 'den': {
            // A racer in no den sorts with the empty string, which puts them
            // first ascending — they are the ones a den still has to be chosen
            // for, so that is the useful end of the list.
            const an = a.den_id == null ? '' : (denNames.get(a.den_id) ?? '');
            const bn = b.den_id == null ? '' : (denNames.get(b.den_id) ?? '');
            return an.localeCompare(bn);
        }
        case 'status':
            // Ascending puts *not* checked in first, which is the actionable
            // order: the question this column answers on race morning is who is
            // still to come, not who is already done.
            return Number(a.car_passed_inspection) - Number(b.car_passed_inspection);
    }
}

/**
 * The roster in the requested order.
 *
 * Ties break on car number and then on name, so the order is total — otherwise
 * sorting by den reshuffles everybody within a den on every re-render, which on
 * a page that refetches on every check-in is a table that will not sit still.
 */
export function sortRacers<T extends SortableRacer>(
    racers: readonly T[],
    dens: readonly SortableDen[],
    state: SortState = DEFAULT_SORT,
): T[] {
    const denNames = new Map(dens.map((den) => [den.id, den.name]));
    const direction = state.direction === 'asc' ? 1 : -1;

    return racers.slice().sort((a, b) => {
        const primary = compare(a, b, state.key, denNames);
        if (primary !== 0) return primary * direction;

        // Tie-breaks are *not* reversed. A descending sort by den should still
        // list each den's own racers by car number rather than backwards.
        if (state.key !== 'car_number') {
            const byNumber = compare(a, b, 'car_number', denNames);
            if (byNumber !== 0) return byNumber;
        }
        if (state.key !== 'last_name') {
            const byName = compare(a, b, 'last_name', denNames);
            if (byName !== 0) return byName;
        }
        return a.id - b.id;
    });
}

/** What a header should announce to a screen reader. */
export function ariaSortFor(state: SortState, key: SortKey): 'ascending' | 'descending' | 'none' {
    if (state.key !== key) return 'none';
    return state.direction === 'asc' ? 'ascending' : 'descending';
}
