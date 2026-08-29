import { describe, expect, it } from 'vitest';
import { groupRacersByRacingGroup, UNASSIGNED_RACING_GROUP_ID, type GroupableRacer } from './groupRacersByRacingGroup';

const racer = (over: Partial<GroupableRacer> & { id: number }): GroupableRacer => ({
    racing_group_id: undefined,
    ...over,
});

const RACING_GROUPS = [
    { id: 1, name: 'Wolves', color: '#f00' },
    { id: 2, name: 'Bears', color: '#0f0' },
];

describe('groupRacersByRacingGroup', () => {
    it('buckets racers by their racing group', () => {
        const groups = groupRacersByRacingGroup(
            [
                racer({ id: 1, racing_group_id: 1 }),
                racer({ id: 2, racing_group_id: 2 }),
                racer({ id: 3, racing_group_id: 1 }),
            ],
            RACING_GROUPS,
        );

        const wolves = groups.find((g) => g.racingGroupId === 1);
        expect(wolves?.items.map((r) => r.id)).toEqual([1, 3]);
        const bears = groups.find((g) => g.racingGroupId === 2);
        expect(bears?.items.map((r) => r.id)).toEqual([2]);
    });

    it('groups racers with no racing group under UNASSIGNED_RACING_GROUP_ID', () => {
        const groups = groupRacersByRacingGroup([racer({ id: 1, racing_group_id: undefined })], RACING_GROUPS);

        expect(groups).toHaveLength(1);
        expect(groups[0].racingGroupId).toBe(UNASSIGNED_RACING_GROUP_ID);
        expect(groups[0].racingGroupName).toBe('Unassigned');
    });

    it('orders groups by racing group name, unassigned last', () => {
        // Alphabetically Bears comes before Wolves, and the unassigned group
        // would sort first as an empty name if it were not special-cased —
        // it belongs last instead, as the one still needing a decision.
        const groups = groupRacersByRacingGroup(
            [
                racer({ id: 1, racing_group_id: 1 }),
                racer({ id: 2, racing_group_id: undefined }),
                racer({ id: 3, racing_group_id: 2 }),
            ],
            RACING_GROUPS,
        );

        expect(groups.map((g) => g.racingGroupId)).toEqual([2, 1, UNASSIGNED_RACING_GROUP_ID]);
    });

    it('falls back to "Unknown Racing Group" for a racing group id nothing resolves', () => {
        // Reachable when a racing group is deleted out from under a racer
        // still holding its id.
        const groups = groupRacersByRacingGroup([racer({ id: 1, racing_group_id: 99 })], RACING_GROUPS);

        expect(groups[0].racingGroupName).toBe('Unknown Racing Group');
        expect(groups[0].racingGroupColor).toBe('#eee');
    });

    it('carries the racing group color through for a real racing group', () => {
        const groups = groupRacersByRacingGroup([racer({ id: 1, racing_group_id: 2 })], RACING_GROUPS);

        expect(groups[0].racingGroupColor).toBe('#0f0');
    });
});
