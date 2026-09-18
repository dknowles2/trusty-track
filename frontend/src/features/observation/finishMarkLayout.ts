/**
 * Where each finish mark sits on the timeline strip — not just its `left%`
 * (already `atMs / durationMs`, unchanged), but which *row* it draws on,
 * so two marks that would otherwise overlap stay independently clickable
 * (#1218).
 *
 * Pure arithmetic over plain numbers — no DOM, no React, the same
 * "sweep the pure rule" shape `finishFrames.ts` and `clipBounds.ts` already
 * use. `ReplayPlayer.tsx` is the only real caller.
 *
 * **The bug this exists to fix.** `ReplayPlayer.tsx` used to render every
 * mark on one row, in ascending-`atMs` DOM order, with no `z-index` — so
 * whenever two lanes finished within about a badge-width of each other on
 * the timeline, the later lane's button painted on top of the earlier
 * one's and silently ate its hit area. An operator's real click landed on
 * the wrong lane; Playwright's own click-retry loop found the same thing —
 * "subtree intercepts pointer events" — and retried forever, since the
 * covered element genuinely was visible/enabled/stable, right up to the
 * test's own timeout. See the issue for the trace that found it.
 */

/** A finish mark's minimal placement inputs — a subset of
 * `finishFrames.FinishMark`, so a caller holding the richer type can pass
 * it straight through. */
export interface FinishMarkPlacementLike {
  readonly lane: number;
  readonly atMs: number;
}

export interface FinishMarkPosition extends FinishMarkPlacementLike {
  /** `(atMs / durationMs) * 100` — unchanged from before this module
   * existed; kept on the output so a caller never recomputes it. */
  readonly leftPct: number;
  /** Which band of the strip this mark draws on, `0`-indexed. `0` unless
   * placing it there would put it within `minGapPct` of the last mark
   * already placed on row `0`, in which case row `1` is tried, then `2`. */
  readonly row: number;
}

/** How many rows the strip may grow to before giving up and stacking
 * everything past this many on the last one. Three rows covers every
 * collision this app's own lane counts (2–8) can plausibly produce at
 * once — a fourth simultaneous near-tie within one `minGapPct` band is not
 * a shape worth a fourth row's height on every clip that has none of them;
 * see the loop below for what happens past this cap. */
export const MAX_ROWS = 3;

/**
 * Places every mark on a row such that no two marks on the *same* row sit
 * within `minGapPct` of each other's `leftPct` — greedy, and deterministic
 * for a given `marks` order (this function sorts by `atMs` itself, so the
 * caller's own order does not matter).
 *
 * **Greedy, row by row, first fit.** Marks are placed in ascending-`atMs`
 * order; each one goes on the lowest-numbered row whose own last-placed
 * mark is at least `minGapPct` away (or which is still empty). Because
 * marks arrive sorted and a row's own last-placed `leftPct` therefore only
 * ever increases, checking against just that one value — not every mark
 * already on the row — is enough to guarantee the no-two-marks-within-
 * `minGapPct` property for that row.
 *
 * **An exact tie (`atMs` equal) is not a special case.** Two marks at the
 * identical instant have a `leftPct` gap of `0`, which is less than any
 * positive `minGapPct`, so the second is pushed to the next row exactly
 * as any other collision would be — both stay independently clickable
 * rather than one silently winning the identical position.
 *
 * **Past `MAX_ROWS` simultaneous collisions, the overflow shares the last
 * row rather than growing a fourth.** The loop below always finds *some*
 * row once every row up to `MAX_ROWS - 1` has been tried — the last one,
 * whether or not it actually clears `minGapPct` from what is already
 * there. That is a deliberate, stated exception to the no-two-marks-
 * within-`minGapPct` guarantee above: past this cap, two marks on the
 * bottom row may still be closer than `minGapPct`, and are frontend-
 * clickable at their nearest pixel rather than perfectly separated. A
 * fourth simultaneous near-tie is not a shape this app's lane counts (2–8)
 * make likely, and the alternative — an unbounded strip height — is worse
 * for the common case to buy correctness in one that essentially never
 * happens.
 */
export function layoutFinishMarks<T extends FinishMarkPlacementLike>(
  marks: readonly T[],
  durationMs: number,
  minGapPct: number,
): Array<T & { leftPct: number; row: number }> {
  const sorted = [...marks].sort((a, b) => a.atMs - b.atMs);
  const lastLeftPctByRow: Array<number | null> = new Array(MAX_ROWS).fill(null);
  const result: Array<T & { leftPct: number; row: number }> = [];

  for (const mark of sorted) {
    const leftPct = durationMs > 0 ? (mark.atMs / durationMs) * 100 : 0;
    let row = MAX_ROWS - 1;
    for (let candidate = 0; candidate < MAX_ROWS; candidate += 1) {
      const lastOnRow = lastLeftPctByRow[candidate];
      if (lastOnRow === null || leftPct - lastOnRow >= minGapPct) {
        row = candidate;
        break;
      }
    }
    lastLeftPctByRow[row] = leftPct;
    result.push({ ...mark, leftPct, row });
  }

  return result;
}

/** How many rows a strip laid out by `layoutFinishMarks` actually needs —
 * `1` for an empty list, since an empty strip still renders its own band
 * rather than collapsing to nothing. */
export function rowCount(positions: readonly { row: number }[]): number {
  if (positions.length === 0) return 1;
  return Math.max(...positions.map((p) => p.row)) + 1;
}
