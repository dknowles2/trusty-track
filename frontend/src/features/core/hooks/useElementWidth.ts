import { useCallback, useRef, useState } from 'react';

/**
 * An element's own rendered width in pixels — measured the instant it
 * mounts, and again on every subsequent resize (`ResizeObserver`), not
 * just the window's.
 *
 * Built for `ReplayPlayer.tsx`'s finish-mark strip (#1218's review): sizing
 * `finishMarkLayout.layoutFinishMarks`' `minGapPct` against a constant
 * tuned for one caller's reference frame (the ▶ modal's own ~640px) badly
 * understated how narrow the *other* caller, the audience overlay, can
 * actually render — `OVERLAY_STYLE`'s `width: 80vmin; maxWidth: 90vw`
 * resolves to ~312px at the phone tier `displays.md` documents (390px
 * wide), where a fixed 5% is ~16px, under a single badge's own width. The
 * strip's real width is the only number that can answer "how big is 5% of
 * this, right now", so it has to be measured rather than assumed.
 *
 * **A callback ref**, the same shape `useSheetScale.ts`'s `wrapRef`/
 * `sheetRef` use, and for the identical two reasons documented there: the
 * strip does not exist on the render that mounts its caller (it is
 * conditional on `hasStrip`), so a plain `useRef` object plus a `[]`-keyed
 * `useEffect` would fire once while the ref is still `null` and never
 * again once the strip actually appears; and `eslint-plugin-react-hooks`'
 * `set-state-in-effect` rule flags an effect that reduces to nothing but a
 * conditional `setState`, which measuring directly inside the ref callback
 * itself avoids rather than routes around.
 *
 * **`null` until the element first mounts** — a caller falls back to its
 * own constant for that window, exactly as it would for any other
 * not-yet-measured value. **A `ResizeObserver`-less environment answers
 * with the same shape a real browser gives before its first paint, not a
 * distinct one**: jsdom (this project's own test environment) defines no
 * global `ResizeObserver` at all, so the guard below skips subscribing to
 * further resizes — but the *initial* `offsetWidth` read still runs, and
 * jsdom's own answer for it is always `0` (it lays out nothing). A caller
 * therefore treats `0` the same as `null` — "not really measured" — rather
 * than as a genuine zero-width strip, which is also correct in a real
 * browser: nothing meaningful renders at 0px either.
 */
export function useElementWidth(): [(el: HTMLElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setWidth(el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.offsetWidth));
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return [ref, width];
}
