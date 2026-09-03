/**
 * Learning this race's own turnaround time from its recorded heats (#591).
 *
 * The static `ESTIMATED_HEAT_DURATION_MIN` baseline is a guess made before
 * anyone has raced a single heat — it cannot know whether this pack stages
 * cars quickly or spends two minutes resetting the track between runs. Once
 * a few heats have actually been recorded, the gaps between their
 * `recordedAt` timestamps (#59) *are* the turnaround time: the moment one
 * heat's result was saved to the moment the next one was is everything that
 * happens between heats — staging, arming, running, and writing the result.
 *
 * Pure, no React and no GraphQL: a caller hands over the `recordedAt`
 * strings it already has (in any order) and a baseline to fall back on.
 */

/**
 * A gap longer than this is a break — lunch, a stuck timer, the operator
 * stepping away — not a turnaround. Folding it in would teach the estimate
 * that a heat takes twenty minutes because one once did, for a reason that
 * has nothing to do with pace.
 */
export const PACE_BREAK_CAP_MINUTES = 15;

/**
 * Below this many turnaround gaps, the baseline is trusted over the sample —
 * two or three heats in, "the pace so far" is really "how fast the first
 * heat happened to go," which is closer to noise than to a race's rhythm.
 */
export const MIN_PACE_SAMPLES = 3;

/**
 * How much weight the newest turnaround gets over the running average.
 * Chosen high enough that the estimate tracks a race settling into (or
 * drifting out of) its rhythm within a handful of heats, not so high that
 * one unusually quick or slow heat swings the estimate on its own.
 */
const EMA_ALPHA = 0.35;

export interface PaceEstimate {
    /** Minutes per heat: the learned pace once there is enough of it, the
     * supplied baseline otherwise. */
    minutesPerHeat: number;
    /** How many turnaround gaps this is drawn from. */
    sampleCount: number;
    /** Whether `minutesPerHeat` reflects this race's own heats, or is still
     * the baseline because there are not `MIN_PACE_SAMPLES` of them yet. */
    isLearned: boolean;
}

/**
 * The turnaround times between consecutive recorded heats, in minutes,
 * sorted into the order they actually happened and with breaks removed.
 *
 * `recordedAt` values arrive in whatever order the caller's heats are in —
 * this sorts by the timestamp itself rather than trusting heat number or
 * round order, since a corrected result or a re-run changes when a heat was
 * *recorded* without changing where it sits in the schedule.
 */
export function turnaroundGapsMinutes(
    recordedAt: readonly (string | null | undefined)[]
): number[] {
    const times = recordedAt
        .filter((value): value is string => !!value)
        .map((value) => new Date(value).getTime())
        .filter((value) => !Number.isNaN(value))
        .sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) {
        const minutes = (times[i] - times[i - 1]) / 60_000;
        // A non-positive gap is two heats recorded at literally the same
        // instant, not a turnaround; a gap past the cap is a break.
        if (minutes > 0 && minutes <= PACE_BREAK_CAP_MINUTES) {
            gaps.push(minutes);
        }
    }
    return gaps;
}

/**
 * This race's learned pace, or the baseline while there is not yet enough of
 * it to trust.
 *
 * An exponential moving average over the gaps (oldest first) rather than a
 * plain mean: a plain mean weighs a race's slow first few heats — cars still
 * being staged, an operator still learning the screen — exactly as heavily
 * as its last one, and never catches up to a race that has since found its
 * rhythm.
 */
export function estimatePace(
    recordedAt: readonly (string | null | undefined)[],
    baselineMinutesPerHeat: number
): PaceEstimate {
    const gaps = turnaroundGapsMinutes(recordedAt);
    if (gaps.length < MIN_PACE_SAMPLES) {
        return {
            minutesPerHeat: baselineMinutesPerHeat,
            sampleCount: gaps.length,
            isLearned: false,
        };
    }

    let ema = gaps[0];
    for (let i = 1; i < gaps.length; i++) {
        ema = EMA_ALPHA * gaps[i] + (1 - EMA_ALPHA) * ema;
    }

    return { minutesPerHeat: ema, sampleCount: gaps.length, isLearned: true };
}

/**
 * When the remaining heats would be done, at this pace, starting from `now`.
 * `now` is a parameter rather than read here — the caller supplies the
 * moment, which is what keeps this testable without a clock.
 */
export function estimatedFinishTime(
    remainingHeats: number,
    pace: PaceEstimate,
    now: Date
): Date {
    return new Date(now.getTime() + remainingHeats * pace.minutesPerHeat * 60_000);
}

/** "2:45 PM" — the wall-clock format used everywhere else a moment is shown
 * to an operator rather than logged (`activityLog.ts`, `documents.ts`). */
export function formatClockTime(when: Date): string {
    return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * "~1.8 min/heat" — the per-heat pace, in the volunteer-friendly words the
 * Race Control dashboard shows next to the estimated finish clock time.
 * One decimal place: a bare "2 min/heat" reads as though the app timed
 * nothing, and three significant figures is precision nobody asked for.
 */
export function paceLabel(pace: PaceEstimate): string {
    return `~${pace.minutesPerHeat.toFixed(1)} min/heat`;
}
