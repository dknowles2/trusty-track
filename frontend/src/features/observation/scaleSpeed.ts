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

/**
 * The track card's own signpost for **Show scale speed** on a track with no
 * electronic timer (#1329, gap 3) — the sibling of `raceSettingsSections.ts`'s
 * `scoringNeedsATimerNote` (#1324), read the same informational way: never
 * disabling the checkbox or the ratio input, just saying up front what today
 * turning it on will and won't do.
 *
 * It cannot follow that note's own shape exactly, though, and the reason is
 * worth stating rather than discovering by trying it: scale speed is a
 * **track** setting (`Track.showScaleSpeed`, install-wide, set once on
 * System Settings' own track card) and a time-based scoring strategy is a
 * **race** one (`Race.scoringStrategy`, set per event) — the same track
 * hosts a stopwatch-timed Pinewood Derby one season and a Points-scored one
 * the next, so there is no single race's strategy to gate this note on the
 * way #1324's own note gates on the race currently being edited. A track
 * with no electronic timer is not "scale speed will never show anything"
 * either: `TIMED`/`CUMULATIVE_TIME`/`FASTEST_TIME` scoring still works from
 * a hand-typed, stopwatch time (`.claude/rules/scoring.md`'s Scoring
 * section), and scale speed converts whatever time was recorded regardless
 * of where it came from — only a `POINTS` race, with no time on record at
 * all, genuinely has nothing for it to convert.
 */
export function scaleSpeedNeedsATimerNote(
    timerType: string | null | undefined,
): string | null {
    if (timerType !== 'NONE') return null;
    return 'This track has no electronic timer. Scale speed still works from a hand-typed time under Timed (or Cumulative time, or Fastest single run) scoring; a race scored by place alone (Points) never records a time, so nothing will show there.';
}
