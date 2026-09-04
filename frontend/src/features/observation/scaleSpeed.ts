/**
 * Rendering a lane's scale speed (#610 stage 4).
 *
 * The number itself is computed once, server-side — `Subscription.timing_stats`
 * and `raceStats` both carry it already converted through
 * `domain.scale_speed.scale_mph`, the same "one rule, composed once" shape
 * `timing_stats` already follows for a lane's display name (#552). This
 * module is only the display rule: how a number becomes the words on a
 * screen, pure like `recordBreak.ts` and `resultsOverlay.ts` beside it.
 */

/**
 * "217 mph" — a whole number, because a hand-measured track length and a
 * timer reading to the millisecond do not support a decimal's worth of
 * precision; a car with a stopwatch measured to 40 feet is not meaningfully
 * different from one measured to 40.2. Null in, null out: the server has
 * already decided when there is nothing to show (the track's scale speed is
 * off, its length is not configured, or this lane has no time), and this
 * function does not second-guess that.
 */
export function formatScaleMph(mph: number | null | undefined): string | null {
    if (mph === null || mph === undefined) return null;
    return `${Math.round(mph)} mph`;
}
