import { describe, expect, it } from 'vitest';
import { groupRacersByDen, UNASSIGNED_DEN_ID, type GroupableRacer } from './groupRacersByDen';

const racer = (over: Partial<GroupableRacer> & { id: number }): GroupableRacer => ({
    den_id: undefined,
    ...over,
});

const DENS = [
    { id: 1, name: 'Wolves', color: '#f00' },
    { id: 2, name: 'Bears', color: '#0f0' },
];

describe('groupRacersByDen', () => {
    it('buckets racers by their den', () => {
        const groups = groupRacersByDen(
            [racer({ id: 1, den_id: 1 }), racer({ id: 2, den_id: 2 }), racer({ id: 3, den_id: 1 })],
            DENS,
        );

        const wolves = groups.find((g) => g.denId === 1);
        expect(wolves?.items.map((r) => r.id)).toEqual([1, 3]);
        const bears = groups.find((g) => g.denId === 2);
        expect(bears?.items.map((r) => r.id)).toEqual([2]);
    });

    it('groups racers with no den under UNASSIGNED_DEN_ID', () => {
        const groups = groupRacersByDen([racer({ id: 1, den_id: undefined })], DENS);

        expect(groups).toHaveLength(1);
        expect(groups[0].denId).toBe(UNASSIGNED_DEN_ID);
        expect(groups[0].denName).toBe('Unassigned');
    });

    it('orders groups by den name, unassigned last', () => {
        // Alphabetically Bears comes before Wolves, and the unassigned group
        // would sort first as an empty name if it were not special-cased —
        // it belongs last instead, as the one still needing a decision.
        const groups = groupRacersByDen(
            [racer({ id: 1, den_id: 1 }), racer({ id: 2, den_id: undefined }), racer({ id: 3, den_id: 2 })],
            DENS,
        );

        expect(groups.map((g) => g.denId)).toEqual([2, 1, UNASSIGNED_DEN_ID]);
    });

    it('falls back to "Unknown Den" for a den id nothing resolves', () => {
        // Reachable when a den is deleted out from under a racer still
        // holding its id.
        const groups = groupRacersByDen([racer({ id: 1, den_id: 99 })], DENS);

        expect(groups[0].denName).toBe('Unknown Den');
        expect(groups[0].denColor).toBe('#eee');
    });

    it('carries the den color through for a real den', () => {
        const groups = groupRacersByDen([racer({ id: 1, den_id: 2 })], DENS);

        expect(groups[0].denColor).toBe('#0f0');
    });
});
