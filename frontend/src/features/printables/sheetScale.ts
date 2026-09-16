/**
 * Shrinking a fixed-size print sheet preview to fit a narrow screen (#1142).
 *
 * `Printables.tsx`'s `.print-sheets` grid and `Certificate.tsx`'s
 * `.certificates` column both size their cards in inches (`documents.ts`,
 * `certificate.ts`) so the screen preview matches the printed page exactly —
 * which means neither ever shrinks to fit a phone on its own. Centred in a
 * page narrower than the sheet itself, the sheet's left edge ends up off the
 * left of the viewport with no way to scroll to it (the bug report's own
 * "first column is cut off and unreachable").
 *
 * Pure — no React, no DOM — so it can be tested without a real layout
 * engine; `useSheetScale.ts` is the only caller, and does the measuring.
 */

/**
 * How much to shrink a sheet whose natural width is `naturalWidth` so it
 * fits inside `containerWidth`.
 *
 * Never above `1` — a container wider than the sheet leaves it at its true
 * size rather than enlarging it, which is what keeps a desktop screen's
 * preview pixel-identical to before this existed. `0` or negative width on
 * either side means "nothing has been measured yet" (the very first paint,
 * or a test environment with no real layout engine, where `offsetWidth` is
 * always `0`) rather than "shrink to nothing" — `1` is the safe default
 * there, the same as never having scaled at all.
 */
export function scaleFor(containerWidth: number, naturalWidth: number): number {
    if (containerWidth <= 0 || naturalWidth <= 0) return 1;
    return Math.min(1, containerWidth / naturalWidth);
}
