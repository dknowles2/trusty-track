import { describe, expect, it } from 'vitest';
import {
    ariaSortFor,
    DEFAULT_SORT,
    nextSortState,
    sortRacers,
    type SortableRacer,
} from './rosterSort';

const racer = (over: Partial<SortableRacer> & { id: number }): SortableRacer => ({
    first_name: 'A',
    last_name: 'A',
    car_number: null,
    racing_group_id: null,
    car_passed_inspection: false,
    ...over,
});

const RACING_GROUPS = [
    { id: 1, name: 'Wolves' },
    { id: 2, name: 'Bears' },
];

const ids = (racers: readonly SortableRacer[]) => racers.map((r) => r.id);

describe('sortRacers', () => {
    it('defaults to car number ascending', () => {
        const sorted = sortRacers(
            [racer({ id: 1, car_number: 9 }), racer({ id: 2, car_number: 3 })],
            RACING_GROUPS,
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('puts unnumbered racers last, as the printables do', () => {
        // They are the ones still needing a number, which is easier to spot at
        // the end of a list than in the middle of one.
        const sorted = sortRacers(
            [racer({ id: 1, car_number: null }), racer({ id: 2, car_number: 40 })],
            RACING_GROUPS,
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('does not mutate what it was given', () => {
        // The same array is the query result React is holding.
        const racers = [racer({ id: 1, car_number: 9 }), racer({ id: 2, car_number: 3 })];

        sortRacers(racers, RACING_GROUPS);

        expect(ids(racers)).toEqual([1, 2]);
    });

    it('sorts by surname then forename', () => {
        const sorted = sortRacers(
            [
                racer({ id: 1, last_name: 'Zeta', first_name: 'Ann' }),
                racer({ id: 2, last_name: 'Alpha', first_name: 'Zoe' }),
            ],
            RACING_GROUPS,
            { key: 'last_name', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('sorts by racingGroup name rather than racingGroup id', () => {
        // The ids are in the opposite order to the names, so an implementation
        // that sorted on the raw column would pass a laxer test.
        const sorted = sortRacers(
            [racer({ id: 1, racing_group_id: 1 }), racer({ id: 2, racing_group_id: 2 })],
            RACING_GROUPS,
            { key: 'racingGroup', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('puts racers in no racingGroup first, where a racingGroup still has to be chosen', () => {
        const sorted = sortRacers(
            [racer({ id: 1, racing_group_id: 1 }), racer({ id: 2, racing_group_id: null })],
            RACING_GROUPS,
            { key: 'racingGroup', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('survives a racingGroup that no longer exists', () => {
        const sorted = sortRacers(
            [racer({ id: 1, racing_group_id: 999 }), racer({ id: 2, racing_group_id: 1 })],
            RACING_GROUPS,
            { key: 'racingGroup', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([1, 2]);
    });

    it('sorts by status with the outstanding racers first', () => {
        // The question this column answers on race morning is who is still to
        // come, not who is already done.
        const sorted = sortRacers(
            [
                racer({ id: 1, car_passed_inspection: true }),
                racer({ id: 2, car_passed_inspection: false }),
            ],
            RACING_GROUPS,
            { key: 'status', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('reverses when asked', () => {
        const sorted = sortRacers(
            [racer({ id: 1, car_number: 1 }), racer({ id: 2, car_number: 2 })],
            RACING_GROUPS,
            { key: 'car_number', direction: 'desc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('does not reverse the tie-break', () => {
        // Descending by racingGroup should still list each racingGroup's own racers by car
        // number, rather than backwards within the group.
        const sorted = sortRacers(
            [
                racer({ id: 1, racing_group_id: 1, car_number: 20 }),
                racer({ id: 2, racing_group_id: 1, car_number: 10 }),
                racer({ id: 3, racing_group_id: 2, car_number: 5 }),
            ],
            RACING_GROUPS,
            { key: 'racingGroup', direction: 'desc' },
        );

        expect(ids(sorted)).toEqual([2, 1, 3]);
    });

    it('is total, so the table sits still across refetches', () => {
        // Every racer here is identical on the sort key and on both tie-breaks.
        const identical = [3, 1, 2].map((id) => racer({ id, car_number: 7 }));

        expect(ids(sortRacers(identical, RACING_GROUPS, { key: 'status', direction: 'asc' }))).toEqual([
            1, 2, 3,
        ]);
    });
});

describe('nextSortState', () => {
    it('starts a new column ascending', () => {
        expect(nextSortState({ key: 'last_name', direction: 'desc' }, 'racingGroup')).toEqual({
            key: 'racingGroup',
            direction: 'asc',
        });
    });

    it('flips the column already sorted', () => {
        expect(nextSortState({ key: 'racingGroup', direction: 'asc' }, 'racingGroup')).toEqual({
            key: 'racingGroup',
            direction: 'desc',
        });
    });

    it('flips back rather than cycling to unsorted', () => {
        // "Unsorted" would mean insertion order, which is the arbitrary one
        // this replaced.
        expect(nextSortState({ key: 'racingGroup', direction: 'desc' }, 'racingGroup')).toEqual({
            key: 'racingGroup',
            direction: 'asc',
        });
    });
});

describe('ariaSortFor', () => {
    it('announces only the column actually sorted', () => {
        expect(ariaSortFor(DEFAULT_SORT, 'car_number')).toBe('ascending');
        expect(ariaSortFor(DEFAULT_SORT, 'last_name')).toBe('none');
    });

    it('announces the direction', () => {
        expect(ariaSortFor({ key: 'last_name', direction: 'desc' }, 'last_name')).toBe('descending');
    });
});
