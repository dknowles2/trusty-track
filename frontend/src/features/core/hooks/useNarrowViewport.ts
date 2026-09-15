import { useEffect, useState } from 'react';

/**
 * Whether the viewport is currently narrower than `breakpoint` (600px by
 * default — the same width `RaceStats.css`'s own `@media (max-width:
 * 600px)` rules key on).
 *
 * A chart's axis labels are drawn by Recharts as SVG text, in JS, not laid
 * out by CSS — so a `@media` rule cannot shorten "Lane 1" to "L1" or force
 * `interval={0}` the way `.mobile-hide`/`.lb-col-avatar` hide a table
 * column. Reading the viewport width in JS is the only way to switch a
 * chart prop at a breakpoint, which is what #1147's Lane Fairness and Dens
 * Comparison charts need under 600px. `window.innerWidth` plus a `resize`
 * listener, generalised from the one-off copy `Navigation.tsx`'s own
 * `MOBILE_BREAKPOINT` check already inlines at 768px — not `matchMedia`,
 * which jsdom does not implement (confirmed against the pinned jsdom
 * version; `window.matchMedia` is `undefined` there), so a hook built on it
 * would need every caller's test to stub it rather than working out of the
 * box the way `innerWidth` already does.
 */
export function useNarrowViewport(breakpoint = 600): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= breakpoint);

  useEffect(() => {
    const handleResize = () => setNarrow(window.innerWidth <= breakpoint);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return narrow;
}
