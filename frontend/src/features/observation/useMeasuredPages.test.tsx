// @vitest-environment jsdom
import '../../setupTests';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useMeasuredPages, type MeasuredPages } from './useMeasuredPages';
import type { ScrollBehavior } from './displayView';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/**
 * The extraction target for `StandingsOnlyView.tsx`'s own measuring and
 * paging (#1073 part 2) — `StandingsOnlyView.test.tsx` already exercises
 * this through that component and continues to pass unchanged (see that
 * file), so these tests are the hook's own shape.
 *
 * `renderHook` alone gives a `containerRef` that is never attached to a real
 * DOM node — the hook has nothing to measure and always falls back to its
 * initial guess. A small harness component renders the two elements the hook
 * expects to measure, the same way `StandingsOnlyView` itself does, so
 * `HTMLElement.prototype.clientHeight` mocks (the same trick that file's own
 * test uses) actually reach something.
 */
function Harness({
    items,
    behavior,
    cycleMs,
    onResult,
}: {
    items: readonly number[];
    behavior: ScrollBehavior;
    cycleMs: number;
    onResult: (result: MeasuredPages<number>) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const result = useMeasuredPages(containerRef, contentRef, items, { behavior, cycleMs });
    onResult(result);
    return (
        <div ref={containerRef}>
            <div ref={contentRef} />
        </div>
    );
}

function renderHarness(overrides: Partial<React.ComponentProps<typeof Harness>> = {}) {
    let latest: MeasuredPages<number> | undefined;
    const onResult = (r: MeasuredPages<number>) => {
        latest = r;
    };
    const behavior = overrides.behavior ?? 'PAGING';
    const cycleMs = overrides.cycleMs ?? 10000;
    const view = render(
        <Harness items={[1, 2, 3]} behavior={behavior} cycleMs={cycleMs} onResult={onResult} {...overrides} />,
    );
    return {
        ...view,
        current: () => latest!,
        // Re-renders with the same `onResult` closure (rather than a fresh
        // one from `overrides`), so `current()` keeps reading the latest
        // result across the re-render the same way a real subscription
        // payload replacing an empty `items` array would (#1155).
        rerenderWithItems: (items: readonly number[]) =>
            view.rerender(<Harness items={items} behavior={behavior} cycleMs={cycleMs} onResult={onResult} />),
    };
}

describe('useMeasuredPages', () => {
    it('renders everything on one page when it all fits (no clientHeight override, PAGING)', () => {
        const items = [1, 2, 3];
        const { current } = renderHarness({ items });

        expect(current().visible).toEqual(items);
        expect(current().pageCount).toBe(1);
        expect(current().page).toBe(0);
        expect(current().offset).toBe(0);
    });

    it('pages once the measured room says the list does not fit on one screen', () => {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 100, // one row's worth at the default 88px guess
        });
        try {
            const items = Array.from({ length: 5 }, (_, i) => i);
            const { current } = renderHarness({ items });

            expect(current().pageSize).toBe(1);
            expect(current().pageCount).toBe(5);
            expect(current().visible).toEqual([0]);
        } finally {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });

    it('advances a page as elapsed time crosses cycleMs, self-healing rather than drifting', () => {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 100,
        });
        try {
            vi.useFakeTimers();
            const items = Array.from({ length: 3 }, (_, i) => i);
            const { current } = renderHarness({ items, cycleMs: 1000 });

            expect(current().page).toBe(0);

            act(() => {
                vi.advanceTimersByTime(1000);
            });

            expect(current().page).toBe(1);
        } finally {
            vi.useRealTimers();
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });

    it('never pages in SMOOTH mode — the whole list is always "visible", moved by offset instead', () => {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 100,
        });
        try {
            const items = Array.from({ length: 30 }, (_, i) => i);
            const { current } = renderHarness({ items, behavior: 'SMOOTH' });

            expect(current().visible).toEqual(items);
        } finally {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });

    it('cleans up its ticking interval on unmount', () => {
        vi.useFakeTimers();
        const clearSpy = vi.spyOn(global, 'clearInterval');

        const { unmount } = renderHarness({ behavior: 'SMOOTH' });
        unmount();

        expect(clearSpy).toHaveBeenCalled();
    });

    // #1155: `displayResolutions.spec.ts`'s 8-lane Standings case flaked in
    // CI by finding zero `.standing-row`s at the moment it measured — a
    // slow backend under load handing the leaderboard subscription its
    // first real payload after the page had already rendered an empty
    // list. This pins that the hook itself does the right thing once that
    // payload lands: `visible` is computed straight from `items`, `page`
    // and `pageSize` on every render (`pageSlice` below), with no gate that
    // could leave it stuck at the empty list's own answer — so the fix
    // for #1155 lives in the spec's own wait, not here. Kept anyway, as the
    // pin the issue asked for against a future regression that *did* add
    // such a gate.
    it('shows rows once a later roster arrival replaces an initially empty list', () => {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 1000, // comfortably more than one row's worth
        });
        try {
            const { current, rerenderWithItems } = renderHarness({ items: [] });
            expect(current().visible).toEqual([]);
            expect(current().pageCount).toBe(1);

            const arrived = Array.from({ length: 5 }, (_, i) => i);
            rerenderWithItems(arrived);

            expect(current().visible).toEqual(arrived);
            expect(current().pageCount).toBe(1);
        } finally {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });

    it('keeps the previous page size rather than collapsing to one when nothing has laid out yet (clientHeight === 0)', () => {
        // jsdom lays nothing out by default, so `clientHeight` reads 0 unless
        // a test overrides it — this pins that the hook falls back to its
        // initial guess (derived from `window.innerHeight`, itself pinned
        // elsewhere as this project's jsdom-default check) rather than the
        // degenerate "one row fits" answer a raw zero would otherwise imply.
        const items = Array.from({ length: 3 }, (_, i) => i);
        const { current } = renderHarness({ items });

        expect(current().pageSize).toBeGreaterThan(1);
    });
});
