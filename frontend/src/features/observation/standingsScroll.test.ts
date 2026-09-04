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
