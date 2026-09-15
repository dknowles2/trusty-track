/**
 * True when the viewport is at or narrower than `breakpointPx`, kept current
 * across a resize (#1137). The same `window.innerWidth`-plus-`resize`-listener
 * shape `Navigation.tsx`'s own `MOBILE_BREAKPOINT` check already uses — that
 * one is inlined rather than exported, so this is the first reusable copy,
 * not a second one competing with an existing hook. No `matchMedia` in this
 * codebase yet; grepped for one before adding this.
 *
 * A plain measured boolean rather than a CSS-only toggle (compare
 * `.mobile-hide`/`.mobile-only-cards` on the roster table) because the two
 * renderings this backs — Home's race table and its per-race cards — each
 * carry their own `data-testid`s for the same race (the row's own `⋯` menu,
 * the card's own). Mounting only one at a time keeps every test id unique
 * in the DOM instead of relying on `getAllBy*` to pick the visible copy.
 */

import { useEffect, useState } from 'react';

function isNarrow(breakpointPx: number): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= breakpointPx;
}

export function useNarrowViewport(breakpointPx: number): boolean {
    const [narrow, setNarrow] = useState(() => isNarrow(breakpointPx));

    useEffect(() => {
        const handleResize = () => setNarrow(isNarrow(breakpointPx));
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [breakpointPx]);

    return narrow;
}
