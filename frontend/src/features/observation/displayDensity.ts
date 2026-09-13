/**
 * How much a small screen can afford to show (#1073 part 2).
 *
 * A projector thirty feet from the bleachers earns nothing back for printing
 * a racing-group division under a racer's name, or a car's own name beside
 * its lane number — that second line costs a whole row of vertical space an
 * audience display would rather spend making everything else bigger, or
 * fitting one more row before it has to page. Below the threshold this
 * module names, those secondary lines disappear; the *primary* columns
 * (rank, racer, score, runs — `docs/observation-displays.md`'s own list of
 * what the Standings tab keeps) never do. Dropping a primary column here
 * would make that page's claim false rather than extend it.
 *
 * Pure, no React — the same split `slideshow.ts` and `standingsScroll.ts`
 * draw, so a table-driven test can sweep every viewport the app is asked to
 * render at without a DOM.
 */

/**
 * The width below which a secondary line of text — a racing-group division,
 * a car's own name — costs more room than it earns back read from across a
 * gym. Picked at 1024px: the narrower edge of an XGA projector (1024×768,
 * the commonest old-projector native resolution — `CLAUDE.md`'s own
 * viewport table) keeps every secondary line, and an SVGA one (800×600, the
 * floor) drops them.
 */
const SECONDARY_TEXT_MIN_WIDTH_PX = 1024;

/**
 * The width below which "Now Racing", "On Deck" and "After That" no longer
 * fit in one row. Each heat card has a 300px floor (`renderHeatCard`'s own
 * `minWidth`) and the row has two 20px gaps between three cards, so three
 * side by side need 940px plus the page's own 40px of padding — under that,
 * `heat-cards-layout`'s `flexWrap` stacks a card onto its own line instead.
 * Measured directly at the SVGA floor this issue exists for: at 800×600 with
 * a 6-lane heat, three stacked cards ran to over 900px tall — more than the
 * *whole* viewport, before the Standings table below them had drawn a single
 * row. Reusing the same 1024px line as the secondary-text threshold rather
 * than a second, nearby constant: every viewport `CLAUDE.md`'s own table
 * names sits cleanly on one side or the other (800 below, every one of
 * 1024/1280/1920 above, all comfortably clear of the 980px arithmetic
 * floor), so a second threshold here would only ever agree with this one at
 * every viewport actually in use.
 */
const AFTER_THAT_MIN_WIDTH_PX = 1024;

export interface DisplayDensity {
    /**
     * Whether a secondary line under a name — a racing-group division on
     * the Standings tab and the heat cards, a car's own name on the Timing
     * tab — earns its row at this size.
     */
    showSecondaryText: boolean;
    /**
     * How many upcoming heats "On Deck" shows, beyond the one currently
     * racing — 2 ("On Deck" and "After That") ordinarily, 1 (just "On
     * Deck") once the row can no longer hold three cards side by side
     * without pushing the Standings table below them off the screen.
     */
    onDeckDepth: 1 | 2;
}

/**
 * What a screen of this width may afford to show.
 *
 * Row *count* on the Standings table itself is deliberately not this
 * module's job even though it is the other half of "density" —
 * `useMeasuredPages` already measures a container's real height and pages
 * through whatever does not fit, which is the actual answer to "how many
 * rows fit" (a fixed guess here could only disagree with it). This module is
 * left with the properties that genuinely depend on width alone: whether a
 * second line of text under a name is worth its row, and how many heat cards
 * the row above the table can afford to show without starving it of room.
 */
export function densityFor(viewportWidth: number): DisplayDensity {
    return {
        showSecondaryText: viewportWidth >= SECONDARY_TEXT_MIN_WIDTH_PX,
        onDeckDepth: viewportWidth >= AFTER_THAT_MIN_WIDTH_PX ? 2 : 1,
    };
}
