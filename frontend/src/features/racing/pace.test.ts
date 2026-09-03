import { describe, expect, it } from 'vitest';
import {
    estimatePace,
    estimatedFinishTime,
    formatClockTime,
    MIN_PACE_SAMPLES,
    PACE_BREAK_CAP_MINUTES,
    paceLabel,
    turnaroundGapsMinutes,
} from './pace';

/** Build ISO timestamps `minutesApart` apart, starting from a fixed instant. */
function timestamps(minutesApart: number[]): string[] {
    const start = new Date('2026-03-14T18:00:00.000Z').getTime();
    let t = start;
    const out = [new Date(t).toISOString()];
    for (const gap of minutesApart) {
        t += gap * 60_000;
        out.push(new Date(t).toISOString());
    }
    return out;
}

describe('turnaroundGapsMinutes', () => {
    it('is empty for fewer than two recorded heats', () => {
        expect(turnaroundGapsMinutes([])).toEqual([]);
        expect(turnaroundGapsMinutes([null, undefined, '2026-03-14T18:00:00.000Z'])).toEqual([]);
    });

    it('measures the gap between consecutive recordings', () => {
        const gaps = turnaroundGapsMinutes(timestamps([2, 1.5]));
        expect(gaps[0]).toBeCloseTo(2, 5);
        expect(gaps[1]).toBeCloseTo(1.5, 5);
    });

    it('sorts by the timestamp itself, not the order supplied', () => {
        const [first, second, third] = timestamps([2, 3]);
        // Handed over out of order — a corrected result can arrive that way.
        const gaps = turnaroundGapsMinutes([third, first, second]);
        expect(gaps).toHaveLength(2);
        expect(gaps[0]).toBeCloseTo(2, 5);
        expect(gaps[1]).toBeCloseTo(3, 5);
    });

    it('drops null, undefined and unparseable values', () => {
        const [first, second] = timestamps([2]);
        const gaps = turnaroundGapsMinutes([first, null, undefined, 'not a date', second]);
        expect(gaps).toEqual([expect.closeTo(2, 5)]);
    });

    it('excludes a gap at or beyond the break cap', () => {
        const gaps = turnaroundGapsMinutes(timestamps([5, PACE_BREAK_CAP_MINUTES + 1, 2]));
        expect(gaps).toHaveLength(2);
        expect(gaps[0]).toBeCloseTo(5, 5);
        expect(gaps[1]).toBeCloseTo(2, 5);
    });

    it('excludes a non-positive gap (two heats recorded at once)', () => {
        const stamp = '2026-03-14T18:00:00.000Z';
        const gaps = turnaroundGapsMinutes([stamp, stamp]);
        expect(gaps).toEqual([]);
    });
});

describe('estimatePace', () => {
    const baseline = 1.75;

    it('falls back to the baseline below MIN_PACE_SAMPLES gaps', () => {
        const recordedAt = timestamps(Array(MIN_PACE_SAMPLES - 2).fill(2));
        const pace = estimatePace(recordedAt, baseline);
        expect(pace.isLearned).toBe(false);
        expect(pace.minutesPerHeat).toBe(baseline);
        expect(pace.sampleCount).toBeLessThan(MIN_PACE_SAMPLES);
    });

    it('learns the pace once there are enough samples', () => {
        // A steady two minutes a heat should be learned as close to two
        // minutes, whatever the baseline says.
        const recordedAt = timestamps(Array(MIN_PACE_SAMPLES + 2).fill(2));
        const pace = estimatePace(recordedAt, baseline);
        expect(pace.isLearned).toBe(true);
        expect(pace.sampleCount).toBe(MIN_PACE_SAMPLES + 2);
        expect(pace.minutesPerHeat).toBeCloseTo(2, 1);
    });

    it('weighs recent heats more than early ones', () => {
        // Starts slow, settles fast. The learned pace should sit closer to
        // the recent, faster gaps than a plain mean of everything would.
        const recordedAt = timestamps([3, 3, 3, 1, 1, 1]);
        const pace = estimatePace(recordedAt, baseline);
        const plainMean = (3 + 3 + 3 + 1 + 1 + 1) / 6;
        expect(pace.minutesPerHeat).toBeLessThan(plainMean);
    });

    it('ignores a break in the middle of the race', () => {
        // Four ordinary two-minute turnarounds, with a half-hour lunch break
        // folded in — the learned pace should still read close to two
        // minutes, not be dragged toward the break.
        const recordedAt = timestamps([2, 2, 30, 2, 2]);
        const pace = estimatePace(recordedAt, baseline);
        expect(pace.isLearned).toBe(true);
        expect(pace.minutesPerHeat).toBeCloseTo(2, 0);
    });
});

describe('estimatedFinishTime', () => {
    it('adds the remaining heats at the given pace to now', () => {
        const now = new Date('2026-03-14T18:00:00.000Z');
        const pace = { minutesPerHeat: 2, sampleCount: 5, isLearned: true };
        const finish = estimatedFinishTime(5, pace, now);
        expect(finish.getTime() - now.getTime()).toBe(10 * 60_000);
    });

    it('is now when there are no heats left', () => {
        const now = new Date('2026-03-14T18:00:00.000Z');
        const pace = { minutesPerHeat: 2, sampleCount: 5, isLearned: true };
        expect(estimatedFinishTime(0, pace, now).getTime()).toBe(now.getTime());
    });
});

describe('formatClockTime', () => {
    it('renders a wall-clock time', () => {
        // Exact wording depends on locale, but it always names an hour and
        // reads as a time of day rather than a duration.
        const text = formatClockTime(new Date('2026-03-14T18:00:00.000Z'));
        expect(text).toMatch(/\d{1,2}:\d{2}/);
    });
});

describe('paceLabel', () => {
    it('shows one decimal place with a unit', () => {
        expect(paceLabel({ minutesPerHeat: 1.8, sampleCount: 6, isLearned: true })).toBe(
            '~1.8 min/heat'
        );
    });

    it('rounds to one decimal place', () => {
        expect(paceLabel({ minutesPerHeat: 1.75, sampleCount: 0, isLearned: false })).toBe(
            '~1.8 min/heat'
        );
    });
});
