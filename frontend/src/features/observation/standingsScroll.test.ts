import { describe, expect, it } from 'vitest';
import { pageCount, pageForElapsed, pageSlice, scrollOffset } from './standingsScroll';

describe('pageCount', () => {
    it('splits a list evenly', () => {
        expect(pageCount(20, 5)).toBe(4);
    });

    it('rounds a partial last page up', () => {
        expect(pageCount(21, 5)).toBe(5);
    });

    it('is always at least one, even for an empty list', () => {
        expect(pageCount(0, 5)).toBe(1);
    });

    it('is always at least one when nothing has been measured yet', () => {
        expect(pageCount(20, 0)).toBe(1);
    });
});

describe('pageForElapsed', () => {
    it('starts on the first page', () => {
        expect(pageForElapsed(0, 10000, 4)).toBe(0);
    });

    it('advances a page once a full interval has elapsed', () => {
        expect(pageForElapsed(10000, 10000, 4)).toBe(1);
        expect(pageForElapsed(19999, 10000, 4)).toBe(1);
        expect(pageForElapsed(20000, 10000, 4)).toBe(2);
    });

    it('wraps back to the first page after the last', () => {
        expect(pageForElapsed(40000, 10000, 4)).toBe(0);
    });

    it('is a pure function of elapsed time — two equivalent instants agree', () => {
        // The whole point: whatever instant a delayed tick actually reads,
        // the answer is the same one a fresh page load would compute for
        // that instant. There is no state to have drifted — a full cycle
        // (cycleMs * count) later is the same page.
        expect(pageForElapsed(95000, 10000, 4)).toBe(pageForElapsed(95000 - 40000, 10000, 4));
    });

    it('stays on the one page there is when the list fits', () => {
        expect(pageForElapsed(999999, 10000, 1)).toBe(0);
    });

    it('does not divide by a zero interval', () => {
        expect(pageForElapsed(5000, 0, 4)).toBe(0);
    });

    // The one call site (`StandingsOnlyView.tsx`) always derives its page
    // count from `pageCount(itemCount, pageSize)` and hands that straight to
    // `pageForElapsed` as `count` — the two are only correct together
    // because that pairing holds. Nothing before this pinned that a page
    // index can never come out ahead of (or behind) the count that produced
    // it, which is exactly the kind of thing `test_domain_scheduling.py`
    // sweeps rather than trusts from reading the arithmetic. A page index
    // outside `[0, count)` would mean `pageSlice` renders past the end of
    // the standings, or before its start.
    it('stays in range for pageCount(itemCount, pageSize) across a sweep of inputs', () => {
        const itemCounts = [0, 1, 2, 3, 5, 7, 10, 23, 40];
        const pageSizes = [0, 1, 2, 3, 5, 8, 10, 15];
        const cycleMses = [0, 1, 100, 5000, 10000];
        // Elapsed time is unbounded in practice — a projector left running
        // for hours — so this sweeps well past any one cycle to catch a
        // wraparound bug the first cycle alone would not show.
        const elapsedSamples = [0, 1, 500, 4999, 5000, 9999, 10000, 10001, 54321, 999999];

        for (const itemCount of itemCounts) {
            for (const pageSize of pageSizes) {
                const count = pageCount(itemCount, pageSize);
                // `pageCount` promises at least one page always.
                expect(count).toBeGreaterThanOrEqual(1);

                for (const cycleMs of cycleMses) {
                    for (const elapsedMs of elapsedSamples) {
                        const page = pageForElapsed(elapsedMs, cycleMs, count);
                        expect(page).toBeGreaterThanOrEqual(0);
                        expect(page).toBeLessThan(count);
                        expect(Number.isInteger(page)).toBe(true);
                    }
                }
            }
        }
    });
});

describe('pageSlice', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);

    it('takes the first page', () => {
        expect(pageSlice(items, 0, 10)).toEqual(items.slice(0, 10));
    });

    it('takes a later, partial page', () => {
        expect(pageSlice(items, 2, 10)).toEqual(items.slice(20, 23));
    });

    it('returns everything when there is no page size to slice by', () => {
        expect(pageSlice(items, 0, 0)).toEqual(items);
    });
});

describe('scrollOffset', () => {
    it('starts paused at the top', () => {
        expect(scrollOffset(0, 1000, 10000, 2000)).toBe(0);
        expect(scrollOffset(1999, 1000, 10000, 2000)).toBe(0);
    });

    it('is at the top of the pass exactly when the pause ends', () => {
        expect(scrollOffset(2000, 1000, 10000, 2000)).toBe(0);
    });

    it('is halfway down at the midpoint of the pass', () => {
        expect(scrollOffset(2000 + 5000, 1000, 10000, 2000)).toBe(500);
    });

    it('reaches the bottom exactly when the pass completes', () => {
        expect(scrollOffset(2000 + 10000, 1000, 10000, 2000)).toBe(1000);
    });

    it('stays paused at the bottom before looping', () => {
        expect(scrollOffset(2000 + 10000 + 1000, 1000, 10000, 2000)).toBe(1000);
    });

    it('loops back to the top after both pauses and the pass', () => {
        const total = 2000 + 10000 + 2000;
        expect(scrollOffset(total, 1000, 10000, 2000)).toBe(0);
        expect(scrollOffset(total + 5000, 1000, 10000, 2000)).toBe(scrollOffset(5000, 1000, 10000, 2000));
    });

    it('does not move when there is nothing to scroll', () => {
        expect(scrollOffset(50000, 0, 10000)).toBe(0);
    });

    it('does not divide by a zero pass duration', () => {
        expect(scrollOffset(50000, 1000, 0)).toBe(0);
    });
});
