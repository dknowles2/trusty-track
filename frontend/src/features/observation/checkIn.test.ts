import { describe, expect, it } from 'vitest';
import { summarizeCheckIn, type CheckInRacer } from './checkIn';

const RACING_GROUPS = [
    { id: 1, name: 'Wolves', color: '#f00' },
    { id: 2, name: 'Bears', color: '#0f0' },
];

const racer = (over: Partial<CheckInRacer> & { id: number }): CheckInRacer => ({
    firstName: 'Jordan',
    lastName: 'Mitchell',
    carNumber: null,
    carPassedInspection: false,
    racingGroupId: undefined,
    ...over,
});

describe('summarizeCheckIn', () => {
    it('reports nothing registered as the "not yet open" state', () => {
        const summary = summarizeCheckIn([], RACING_GROUPS);
        expect(summary.total).toBe(0);
        expect(summary.checkedIn).toBe(0);
        expect(summary.allCheckedIn).toBe(false);
        expect(summary.groups).toEqual([]);
    });

    it('counts checked-in and total per group', () => {
        const summary = summarizeCheckIn(
            [
                racer({ id: 1, racingGroupId: 1, carPassedInspection: true }),
                racer({ id: 2, racingGroupId: 1, carPassedInspection: false }),
                racer({ id: 3, racingGroupId: 2, carPassedInspection: true }),
            ],
            RACING_GROUPS,
        );

        const wolves = summary.groups.find((g) => g.racingGroupId === 1);
        expect(wolves).toMatchObject({ checkedIn: 1, total: 2, allCheckedIn: false });
        const bears = summary.groups.find((g) => g.racingGroupId === 2);
        expect(bears).toMatchObject({ checkedIn: 1, total: 1, allCheckedIn: true });

        expect(summary.checkedIn).toBe(2);
        expect(summary.total).toBe(3);
        expect(summary.allCheckedIn).toBe(false);
    });

    it('is the finished state only once every registered racer is through', () => {
        const summary = summarizeCheckIn(
            [
                racer({ id: 1, racingGroupId: 1, carPassedInspection: true }),
                racer({ id: 2, racingGroupId: 2, carPassedInspection: true }),
            ],
            RACING_GROUPS,
        );

        expect(summary.allCheckedIn).toBe(true);
        expect(summary.groups.every((g) => g.allCheckedIn)).toBe(true);
    });

    it('lists only the racers still pending in a group\'s missing list', () => {
        const summary = summarizeCheckIn(
            [
                racer({ id: 1, racingGroupId: 1, carPassedInspection: true, carNumber: 5 }),
                racer({ id: 2, racingGroupId: 1, carPassedInspection: false, carNumber: 3 }),
            ],
            RACING_GROUPS,
        );

        const wolves = summary.groups.find((g) => g.racingGroupId === 1);
        expect(wolves?.missing.map((r) => r.id)).toEqual([2]);
    });

    it('sorts missing racers by car number, unnumbered last', () => {
        const summary = summarizeCheckIn(
            [
                racer({ id: 1, racingGroupId: 1, carNumber: 9 }),
                racer({ id: 2, racingGroupId: 1, carNumber: null }),
                racer({ id: 3, racingGroupId: 1, carNumber: 2 }),
            ],
            RACING_GROUPS,
        );

        const wolves = summary.groups.find((g) => g.racingGroupId === 1);
        expect(wolves?.missing.map((r) => r.id)).toEqual([3, 1, 2]);
    });

    it('buckets a racer with no racing group under its own group', () => {
        const summary = summarizeCheckIn(
            [racer({ id: 1, racingGroupId: undefined })],
            RACING_GROUPS,
        );

        expect(summary.groups).toHaveLength(1);
        expect(summary.groups[0].racingGroupName).toBe('Unassigned');
    });

    it('orders groups by name, unassigned last — the roster\'s own order', () => {
        const summary = summarizeCheckIn(
            [
                racer({ id: 1, racingGroupId: 1 }),
                racer({ id: 2, racingGroupId: undefined }),
                racer({ id: 3, racingGroupId: 2 }),
            ],
            RACING_GROUPS,
        );

        expect(summary.groups.map((g) => g.racingGroupName)).toEqual([
            'Bears',
            'Wolves',
            'Unassigned',
        ]);
    });
});
