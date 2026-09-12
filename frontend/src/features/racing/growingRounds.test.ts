import { describe, expect, it } from 'vitest';
import { expectedHeatCount, type GrowingRoundShape } from './growingRounds';

function round(
    schedulingStrategy: string,
    overrides: Partial<GrowingRoundShape> = {}
): GrowingRoundShape {
    return {
        schedulingStrategy,
        eliminationLosses: null,
        balancedPhases: null,
        ...overrides,
    };
}

describe('expectedHeatCount', () => {
    it('is null for PPC — the schedule is built up front and the rows are the truth', () => {
        expect(expectedHeatCount(round('PPC'), 12, 4)).toBeNull();
    });

    it('is null with fewer than two racers or lanes — nothing to estimate', () => {
        expect(expectedHeatCount(round('BALANCED'), 1, 4)).toBeNull();
        expect(expectedHeatCount(round('ELIMINATION'), 8, 1)).toBeNull();
    });

    describe('BALANCED', () => {
        it('is phases times ceil(racers / lanes)', () => {
            // 8 racers, 4 lanes, 3 phases -> 2 heats per phase, 6 total.
            expect(expectedHeatCount(round('BALANCED', { balancedPhases: 3 }), 8, 4)).toBe(6);
        });

        it('defaults phases to the lane count, GPRM"s own advice, matching the backend default', () => {
            // 5 racers, 4 lanes, phases defaults to 4 -> ceil(5/4)=2 per phase, 8 total.
            expect(expectedHeatCount(round('BALANCED'), 5, 4)).toBe(8);
        });

        it('is exact for a field that does not divide evenly', () => {
            // 7 racers, 4 lanes -> ceil(7/4) = 2 heats/phase; 2 phases -> 4.
            expect(
                expectedHeatCount(round('BALANCED', { balancedPhases: 2 }), 7, 4)
            ).toBe(4);
        });
    });

    describe('ELIMINATION', () => {
        it('is a floor for the issue"s own worked example (7 cars, 2 losses, 4 lanes)', () => {
            // Exactly `racerCount - 1` = 6 cars are eliminated, each at
            // `losses` = 2, so the round hands out *at least* 12 losses —
            // the champion's own tally (0 in the best case) never adds to
            // that minimum. ceil(12 / 3) = 4. The issue reports this race
            // actually took 6 heats, which the floor correctly sits below.
            expect(
                expectedHeatCount(round('ELIMINATION', { eliminationLosses: 2 }), 7, 4)
            ).toBe(4);
        });

        it('defaults losses to 1 when unset', () => {
            // (8 - 1) * 1 = 7 losses at minimum, ceil(7 / 3) = 3.
            expect(expectedHeatCount(round('ELIMINATION'), 8, 4)).toBe(3);
        });

        it('is exact on a two-lane track — every heat is a pair retiring exactly one loser, so the minimum total is the only total', () => {
            for (const [n, losses] of [
                [4, 1],
                [6, 2],
                [9, 3],
            ] as const) {
                const heatCount = simulateElimination(n, 2, losses);
                expect(
                    expectedHeatCount(round('ELIMINATION', { eliminationLosses: losses }), n, 2)
                ).toBe(heatCount);
            }
        });

        // A previous version of this formula used `racerCount * losses` as
        // the numerator — bounding the total losses handed out from
        // *above* rather than below, since it counted the eventual
        // champion's own tally as if it always reached the threshold too.
        // That is not a floor: these five cases (found by re-simulating the
        // real `domain.elimination.next_wave`/`chunk_heats` against the
        // adversarial case that minimises heat count — the champion
        // winning every heat it is ever in) all produced a real heat count
        // *below* that formula's estimate, some by a whole heat. The fix
        // is `(racerCount - 1) * losses`: exactly the non-champions'
        // combined minimum, which nothing can ever finish in fewer heats.
        it('is a true floor on the cases that broke the old (racerCount * losses) formula', () => {
            const cases: readonly [racers: number, laneCount: number, losses: number, floor: number][] = [
                [4, 4, 1, 1],
                [16, 4, 1, 5],
                [6, 4, 2, 4],
                [4, 4, 2, 2],
                [4, 4, 3, 3],
            ];
            for (const [racers, laneCount, losses, floor] of cases) {
                const estimate = expectedHeatCount(
                    round('ELIMINATION', { eliminationLosses: losses }),
                    racers,
                    laneCount
                )!;
                expect(estimate).toBe(floor);
                expect(estimate).toBeLessThanOrEqual(simulateElimination(racers, laneCount, losses));
            }
        });

        it('stays within a modest multiple of the real wave-by-wave outcome', () => {
            // A regression that made the formula wildly wrong (double, half)
            // is what this guards — not a tight percentage, since the real
            // schedule depends on wave-by-wave shuffling this module knows
            // nothing about.
            for (const n of [4, 7, 10, 16]) {
                for (const laneCount of [3, 4, 6]) {
                    for (const losses of [1, 2, 3]) {
                        const estimate = expectedHeatCount(
                            round('ELIMINATION', { eliminationLosses: losses }),
                            n,
                            laneCount
                        )!;
                        const actual = simulateElimination(n, laneCount, losses);
                        expect(actual).toBeLessThanOrEqual(estimate * 1.5 + 1);
                    }
                }
            }
        });
    });
});

/**
 * A minimal, deterministic port of `domain/heat_chunks.chunk_heats` and
 * `domain/elimination.next_wave`/`losses_by_racer`, for checking the
 * estimate above against the real wave-by-wave algorithm without a Python
 * process. The lowest-numbered car in a heat always wins — deterministic
 * rather than random, since this is checking the *shape* of the schedule
 * (how many heats a wave needs), not who wins any of them.
 */
function chunkHeats(ordered: number[], heatSize: number): number[][] {
    const n = ordered.length;
    if (n < 2 || heatSize < 1) return [];
    for (let byes = 0; byes < n - 1; byes++) {
        const m = n - byes;
        const minHeats = Math.ceil(m / heatSize);
        const maxHeats = Math.floor(m / 2);
        if (minHeats > maxHeats) continue;
        const numHeats = minHeats;
        const base = Math.floor(m / numHeats);
        const rem = m % numHeats;
        const racing = ordered.slice(0, m);
        const heats: number[][] = [];
        let idx = 0;
        for (let i = 0; i < numHeats; i++) {
            const size = base + (i < rem ? 1 : 0);
            heats.push(racing.slice(idx, idx + size));
            idx += size;
        }
        return heats;
    }
    return [];
}

function simulateElimination(
    racerCount: number,
    laneCount: number,
    maxLosses: number
): number {
    const losses = new Map<number, number>();
    for (let i = 0; i < racerCount; i++) losses.set(i, 0);
    let totalHeats = 0;

    for (let guard = 0; guard < 10_000; guard++) {
        const alive = [...losses.entries()].filter(([, c]) => c < maxLosses).map(([r]) => r);
        if (alive.length <= 1) break;

        const byLosses = new Map<number, number[]>();
        for (const r of alive) {
            const c = losses.get(r)!;
            if (!byLosses.has(c)) byLosses.set(c, []);
            byLosses.get(c)!.push(r);
        }
        const ordered: number[] = [];
        for (const c of [...byLosses.keys()].sort((a, b) => a - b)) {
            ordered.push(...byLosses.get(c)!.sort((a, b) => a - b));
        }

        const wave = chunkHeats(ordered, laneCount);
        if (wave.length === 0) break;
        totalHeats += wave.length;
        for (const heat of wave) {
            const winner = Math.min(...heat);
            for (const r of heat) {
                if (r !== winner) losses.set(r, losses.get(r)! + 1);
            }
        }
    }
    return totalHeats;
}
