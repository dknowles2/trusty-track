/**
 * Getting a long leaderboard through the `STANDINGS_ONLY` view (#663).
 *
 * A pack big enough to want this view is a pack big enough that the
 * leaderboard does not fit one screen, so the view has to move through it on
 * its own — nobody is at the keyboard to page it, and there is no room left
 * for a scrollbar once Now Racing / On Deck are gone.
 *
 * Two behaviours, chosen on the display's row (see `ScrollBehavior` in
 * `displayView.ts`): flip through fixed pages, or scroll continuously from
 * top to bottom. Both are stated here as pure functions of *elapsed
 * wall-clock time* rather than of a counter a `setInterval` increments —
 * which is what a projector left running for an hour actually needs. A
 * counter drifts the moment a tick is delayed or a background tab is
 * throttled: miss five ticks and the page is five pages behind where it
 * should be. A function of elapsed time self-heals instead — whatever
 * instant the next tick actually lands on, it computes the position that
 * instant is supposed to show, the same answer a fresh page load would give
 * for the same clock reading. The React side (`StandingsOnlyView.tsx`) only
 * has to keep calling these on some regular tick; it never has to get the
 * tick itself right.
 */

export type ScrollBehavior = 'PAGING' | 'SMOOTH';

/**
 * How many pages a list of this length splits into, at a given page size.
 *
 * Always at least one, even for an empty list or a page size of zero (no
 * room measured yet) — a page index of 0 must always be something a caller
 * can render, even if that page is empty.
 */
export function pageCount(itemCount: number, pageSize: number): number {
    if (pageSize <= 0 || itemCount <= 0) return 1;
    return Math.max(1, Math.ceil(itemCount / pageSize));
}

/**
 * Which page is on screen right now, cycling forward one page every
 * `cycleMs` of elapsed time.
 */
export function pageForElapsed(elapsedMs: number, cycleMs: number, count: number): number {
    if (count <= 1 || cycleMs <= 0 || elapsedMs < 0) return 0;
    return Math.floor(elapsedMs / cycleMs) % count;
}

/** The slice of a list to show for a given page and page size. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
    if (pageSize <= 0) return items;
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
}

/**
 * The vertical scroll offset for one continuous top-to-bottom pass, in
 * pixels — 0 at the very top, `scrollableHeight` at the very bottom —
 * pausing at each end before looping back, so a reader arriving mid-cycle
 * gets a moment at the top to get their bearing rather than catching the
 * list already sliding past.
 *
 * `cycleMs` is the time to travel from top to bottom once; `pauseMs` is
 * spent motionless at each end. Like `pageForElapsed`, this is a pure
 * function of elapsed time, so a delayed or throttled tick lands on the
 * offset that instant is supposed to show rather than compounding a lag.
 */
export function scrollOffset(
    elapsedMs: number,
    scrollableHeight: number,
    cycleMs: number,
    pauseMs = 2000,
): number {
    if (scrollableHeight <= 0 || cycleMs <= 0) return 0;
    const total = cycleMs + pauseMs * 2;
    const t = ((elapsedMs % total) + total) % total;
    if (t < pauseMs) return 0;
    if (t < pauseMs + cycleMs) return ((t - pauseMs) / cycleMs) * scrollableHeight;
    return scrollableHeight;
}
