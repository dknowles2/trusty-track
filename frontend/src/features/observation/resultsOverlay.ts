/**
 * Deciding whether the projector's "Heat Results" overlay should pop for the
 * latest `timingStats` payload (#335).
 *
 * Two mistakes, both the same shape as `roundCompletion.ts`'s `seen === null`
 * rule:
 *
 * The subscription delivers an opening snapshot on connect (or reconnect), so
 * a projector that just loaded has "seen" nothing yet — but that snapshot is
 * history, not news. Popping the overlay for it announces a heat that may
 * have finished minutes ago.
 *
 * The old key was `${roundName}-${heatNumber}`, which a re-recorded heat
 * reproduces exactly — a corrected time never re-triggered the overlay. The
 * key here is the heat's id plus when its result was saved, which is the one
 * thing that changes when a result is overwritten (`recorded_at`, the same
 * field `#59` uses to rank official and free heats together).
 */

/** What we had seen last time, or `null` before the first payload. */
export type SeenHeatResult = string | null;

/** The part of a `timingStats` payload this module needs. */
export interface HeatResult {
    readonly heatId: number;
    readonly recordedAt?: string | null;
}

export interface HeatResultObservation {
    /** To carry into the next call. */
    readonly seen: SeenHeatResult;
    /** True when `current` is a result the caller has not shown yet. */
    readonly isNew: boolean;
}

function keyFor(result: HeatResult): string {
    return `${result.heatId}:${result.recordedAt ?? ''}`;
}

/**
 * @param seen  the `seen` from the previous call, or `null` on the first.
 * @param current  the most recently recorded heat's result, or `null` before
 *   any heat has finished.
 */
export function observeHeatResult(seen: SeenHeatResult, current: HeatResult | null): HeatResultObservation {
    if (!current) return { seen, isNew: false };

    const key = keyFor(current);
    if (seen === null) {
        // A fresh subscription: this result is already history.
        return { seen: key, isNew: false };
    }

    return { seen: key, isNew: key !== seen };
}
