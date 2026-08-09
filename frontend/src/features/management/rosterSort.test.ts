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
    den_id: null,
    car_passed_inspection: false,
    ...over,
});

const DENS = [
    { id: 1, name: 'Wolves' },
    { id: 2, name: 'Bears' },
];

const ids = (racers: readonly SortableRacer[]) => racers.map((r) => r.id);

describe('sortRacers', () => {
    it('defaults to car number ascending', () => {
        const sorted = sortRacers(
            [racer({ id: 1, car_number: 9 }), racer({ id: 2, car_number: 3 })],
            DENS,
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('puts unnumbered racers last, as the printables do', () => {
        // They are the ones still needing a number, which is easier to spot at
        // the end of a list than in the middle of one.
        const sorted = sortRacers(
            [racer({ id: 1, car_number: null }), racer({ id: 2, car_number: 40 })],
            DENS,
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('does not mutate what it was given', () => {
        // The same array is the query result React is holding.
        const racers = [racer({ id: 1, car_number: 9 }), racer({ id: 2, car_number: 3 })];

        sortRacers(racers, DENS);

        expect(ids(racers)).toEqual([1, 2]);
    });

    it('sorts by surname then forename', () => {
        const sorted = sortRacers(
            [
                racer({ id: 1, last_name: 'Zeta', first_name: 'Ann' }),
                racer({ id: 2, last_name: 'Alpha', first_name: 'Zoe' }),
            ],
            DENS,
            { key: 'last_name', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('sorts by den name rather than den id', () => {
        // The ids are in the opposite order to the names, so an implementation
        // that sorted on the raw column would pass a laxer test.
        const sorted = sortRacers(
            [racer({ id: 1, den_id: 1 }), racer({ id: 2, den_id: 2 })],
            DENS,
            { key: 'den', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('puts racers in no den first, where a den still has to be chosen', () => {
        const sorted = sortRacers(
            [racer({ id: 1, den_id: 1 }), racer({ id: 2, den_id: null })],
            DENS,
            { key: 'den', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('survives a den that no longer exists', () => {
        const sorted = sortRacers(
            [racer({ id: 1, den_id: 999 }), racer({ id: 2, den_id: 1 })],
            DENS,
            { key: 'den', direction: 'asc' },
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
            DENS,
            { key: 'status', direction: 'asc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('reverses when asked', () => {
        const sorted = sortRacers(
            [racer({ id: 1, car_number: 1 }), racer({ id: 2, car_number: 2 })],
            DENS,
            { key: 'car_number', direction: 'desc' },
        );

        expect(ids(sorted)).toEqual([2, 1]);
    });

    it('does not reverse the tie-break', () => {
        // Descending by den should still list each den's own racers by car
        // number, rather than backwards within the group.
        const sorted = sortRacers(
            [
                racer({ id: 1, den_id: 1, car_number: 20 }),
                racer({ id: 2, den_id: 1, car_number: 10 }),
                racer({ id: 3, den_id: 2, car_number: 5 }),
            ],
            DENS,
            { key: 'den', direction: 'desc' },
        );

        expect(ids(sorted)).toEqual([2, 1, 3]);
    });

    it('is total, so the table sits still across refetches', () => {
        // Every racer here is identical on the sort key and on both tie-breaks.
        const identical = [3, 1, 2].map((id) => racer({ id, car_number: 7 }));

        expect(ids(sortRacers(identical, DENS, { key: 'status', direction: 'asc' }))).toEqual([
            1, 2, 3,
        ]);
    });
});

describe('nextSortState', () => {
    it('starts a new column ascending', () => {
        expect(nextSortState({ key: 'last_name', direction: 'desc' }, 'den')).toEqual({
            key: 'den',
            direction: 'asc',
        });
    });

    it('flips the column already sorted', () => {
        expect(nextSortState({ key: 'den', direction: 'asc' }, 'den')).toEqual({
            key: 'den',
            direction: 'desc',
        });
    });

    it('flips back rather than cycling to unsorted', () => {
        // "Unsorted" would mean insertion order, which is the arbitrary one
        // this replaced.
        expect(nextSortState({ key: 'den', direction: 'desc' }, 'den')).toEqual({
            key: 'den',
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
