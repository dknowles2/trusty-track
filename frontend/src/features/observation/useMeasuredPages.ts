/**
 * Measuring how many rows fit a screen, and paging or scrolling through the
 * rest (#1073 part 2).
 *
 * `StandingsOnlyView.tsx` worked this arithmetic out first, for the
 * `STANDINGS_ONLY` view: measure the container's real height with a
 * `ResizeObserver`, work out how many rows of a guessed height fit, and hand
 * that page size to `standingsScroll.ts`'s pure functions on every tick.
 * Pulled out here so the standard mode's own Standings tab can use the same
 * mechanism — see `displays.md`'s "What a small screen drops" for why it
 * needs to: nobody scrolls an audience display, so a table that just grows
 * past the fold is content nobody at the back of the room ever sees.
 *
 * `standingsScroll.ts` still holds every pure rule (`pageCount`,
 * `pageForElapsed`, `pageSlice`, `scrollOffset`); this hook is only the React
 * wiring around it — the same split `raceFlow.ts`/`useRaceFlow.ts` and
 * `slideshow.ts` draw elsewhere on this page.
 */

import { useEffect, useState } from 'react';
import { pageCount, pageForElapsed, pageSlice, scrollOffset, type ScrollBehavior } from './standingsScroll';

export interface UseMeasuredPagesOptions {
    behavior: ScrollBehavior;
    /** The time a page stays up, or a full top-to-bottom pass takes. */
    cycleMs: number;
    /**
     * How tall one row renders, in pixels, before anything has actually been
     * measured — a fixed guess here is better than showing every row at once
     * for a frame while the `ResizeObserver` below catches up. Defaults to
     * `StandingsOnlyView`'s own original constant, since every current
     * caller renders a row of roughly that height (a portrait plus two lines
     * of text).
     */
    approxRowHeightPx?: number;
    /**
     * Room inside `containerRef` that is not available for rows — a
     * `<thead>`, most commonly, when the measured container is the whole
     * `<table>` rather than just its body. Subtracted from the container's
     * measured `clientHeight` before dividing into rows; 0 (nothing to
     * subtract) by default, which is exactly right for a container that
     * holds nothing but rows.
     */
    reservePx?: number;
}

export interface MeasuredPages<T> {
    /** This tick's rows to render — a page's worth in `PAGING`, the whole
     * list in `SMOOTH` (the caller translates it by `offset` instead). */
    visible: readonly T[];
    /** How many pages the list makes at the measured page size. Always at
     * least one, so a page indicator always has something to say. */
    pageCount: number;
    /** Which page is on screen right now (0-based). */
    page: number;
    /** How many rows the measured space fits. */
    pageSize: number;
    /** The `translateY(-offset)` to apply in `SMOOTH` mode; 0 in `PAGING`. */
    offset: number;
}

/**
 * Exported so a caller measuring its own real row height (once one has
 * rendered) can fall back to the identical default in the meantime, rather
 * than guessing a second number that might disagree with this one.
 */
export const DEFAULT_APPROX_ROW_HEIGHT_PX = 88;

/**
 * `containerRef` must point at an element whose own `clientHeight` is
 * actually bounded — a fixed height, or a flex/grid-derived one with
 * `overflow: hidden` — or every row still renders and this measures nothing
 * useful. `contentRef` is the (usually taller) element being scrolled inside
 * it, read only for `SMOOTH`'s own scroll distance.
 */
export function useMeasuredPages<T>(
    containerRef: React.RefObject<HTMLElement | null>,
    contentRef: React.RefObject<HTMLElement | null>,
    items: readonly T[],
    { behavior, cycleMs, approxRowHeightPx = DEFAULT_APPROX_ROW_HEIGHT_PX, reservePx = 0 }: UseMeasuredPagesOptions,
): MeasuredPages<T> {
    // A lazy `useState` initializer, not `useRef(Date.now())` — see
    // `StandingsOnlyView.tsx`'s original comment on this, kept verbatim: a
    // ref's initial-value expression runs on every render even though React
    // discards the result after the first, so it is still an impure call
    // during render; `useState`'s function form is the one React actually
    // guarantees to call once.
    const [start] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    const [pageSize, setPageSize] = useState(() =>
        Math.max(
            1,
            Math.floor(
                Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 800) - reservePx) /
                    approxRowHeightPx,
            ),
        ),
    );
    const [scrollableHeight, setScrollableHeight] = useState(0);

    // How much room this screen actually has, re-measured whenever the list
    // or the window changes. A `ResizeObserver` on the container (rather
    // than just a `resize` listener) is what catches the very first layout
    // too, so a screen never sits on the fallback guess longer than one
    // paint.
    useEffect(() => {
        const measure = () => {
            const container = containerRef.current;
            const content = contentRef.current;
            // A height of zero means "not laid out yet" (the very first
            // paint, or a test environment with no real layout engine), not
            // "there is room for one row" — keep whatever page size is
            // already in play rather than collapsing to the degenerate
            // fallback of one, which would page through a two-line list one
            // row at a time.
            if (container && container.clientHeight > 0) {
                const rowsHeight = Math.max(0, container.clientHeight - reservePx);
                setPageSize(Math.max(1, Math.floor(rowsHeight / approxRowHeightPx)));
            }
            if (container && content && container.clientHeight > 0) {
                setScrollableHeight(Math.max(0, content.scrollHeight - container.clientHeight));
            }
        };
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        if (containerRef.current) observer.observe(containerRef.current);
        return () => observer.disconnect();
        // Re-measure whenever the rendered content changes shape — a longer
        // or shorter list, a switch between paging (a page's worth of rows)
        // and smooth scrolling (every row), or a change to how much of the
        // container is reserved for something other than rows.
    }, [items.length, behavior, containerRef, contentRef, approxRowHeightPx, reservePx]);

    // One tick drives both behaviours, computed fresh each time from elapsed
    // wall-clock time rather than accumulated in a counter — see
    // `standingsScroll.ts` for why that is what keeps a screen left running
    // for an hour from drifting. Smooth scrolling wants a finer tick than
    // paging does; either way the interval is only ever a suggestion to
    // `pageForElapsed`/`scrollOffset`, never the source of truth.
    useEffect(() => {
        const tickMs = behavior === 'SMOOTH' ? 50 : 1000;
        const timer = setInterval(() => setNow(Date.now()), tickMs);
        return () => clearInterval(timer);
    }, [behavior]);

    const elapsedMs = now - start;
    const count = pageCount(items.length, pageSize);
    const page = pageForElapsed(elapsedMs, cycleMs, count);
    const visible = behavior === 'PAGING' ? pageSlice(items, page, pageSize) : items;
    const offset = behavior === 'SMOOTH' ? scrollOffset(elapsedMs, scrollableHeight, cycleMs) : 0;

    return { visible, pageCount: count, page, pageSize, offset };
}
