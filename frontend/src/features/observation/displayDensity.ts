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
 * The heat cards above the Standings tab's table are the other half of the
 * budget: "Now Racing" and "On Deck" (and "After That", when shown) share a
 * fixed slice of the viewport's own height, `heatCardsMaxHeightVh`, so the
 * table underneath always gets a real, predictable remainder rather than
 * whatever the cards happen to need. That only works because the cards are
 * sized to actually fit inside it — see `Observation.tsx`'s `renderHeatCard`
 * for the matching half (a fixed one-row-per-heat grid, an avatar size tied
 * to how many lanes are sharing that row) — this module only decides the
 * budget and how many cards may draw from it.
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
 * fit in one row. Each heat card has a 300px `minWidth` floor
 * (`renderHeatCard`'s own) *plus* its own 20px-a-side padding — a card's
 * true minimum outer width is 340px, not 300 — so three side by side need
 * 3×340 = 1020px, plus the row's own two 20px gaps (40px) and the page's own
 * 40px of padding: 1100px. Under that, `heat-cards-layout`'s `flexWrap`
 * stacks a card onto its own line instead — two cards fit at 984px available
 * (1024 wide) and wrap the third onto a row by itself, which is what
 * genuinely happened at the XGA viewport before this constant accounted for
 * each card's own padding: two rows of cards, rather than one, together ran
 * past the heat-cards budget below even though each individual row (a
 * single avatar row apiece) did not. Every viewport actually in use
 * (`CLAUDE.md`'s own table) sits clear of the 1100px line either way — 1024
 * and below stay under it, 1280 and 1920 stay comfortably over.
 */
const AFTER_THAT_MIN_WIDTH_PX = 1100;

/**
 * Below this viewport height, even "Now Racing" plus "On Deck" side by side
 * (each then a narrower card, so a long name wraps to more lines within it)
 * can cost enough of the fixed `heatCardsMaxHeightVh` budget that the
 * Standings table's own guaranteed-minimum rows no longer fit under it — so
 * "On Deck" drops out entirely and "Now Racing" alone gets the *whole*
 * width, which is what actually buys the height back: the same avatar and
 * font sizes need fewer wrapped lines once a long name has a full-width
 * card's columns to wrap inside instead of a half-width one's. Measured
 * directly at the SVGA floor with this file's own 24-racer/6-lane seed —
 * see `Observation.tsx`'s own render for the sizing this threshold is tuned
 * against. 720px and up (XGA's 768, 720p's 720, 1080p) keep "On Deck"; the
 * 600px SVGA floor drops it.
 */
const ON_DECK_MIN_HEIGHT_PX = 700;

/**
 * The heat cards row's own ceiling, as a percentage of viewport height —
 * handed straight to `maxHeight: '<n>vh'` on `heat-cards-layout`. Sized so
 * the Standings table beneath it always keeps a real, guaranteed remainder:
 * at the fixed, non-`vh` chrome around it (the top bar, the tab buttons,
 * the page's own padding — none of which scale with viewport height, so
 * they cost proportionally more of a short screen) plus this budget, the
 * SVGA floor still keeps enough room under the cards for the Standings
 * table's own header and five real rows. It is a ceiling, not a target —
 * the cards are sized (see this file's own header comment) to sit
 * comfortably under it in the ordinary case, so this is what stops a
 * pathological one (an unusually long line of wrapped names) from pushing
 * the table out from under them rather than something reached every heat.
 */
const HEAT_CARDS_BUDGET_VH = 37;

export interface DisplayDensity {
    /**
     * Whether a secondary line under a name — a racing-group division on
     * the Standings tab and the heat cards, a car's own name on the Timing
     * tab — earns its row at this size.
     */
    showSecondaryText: boolean;
    /**
     * How many upcoming heats the row above the Standings table shows,
     * beyond the one currently racing — 2 ("On Deck" and "After That")
     * ordinarily, 1 (just "On Deck") once the row can no longer hold three
     * cards side by side, 0 (just "Now Racing") once even two cards side by
     * side risk starving the table of its own guaranteed rows.
     */
    onDeckDepth: 0 | 1 | 2;
    /** The heat cards row's own height ceiling, as a bare `vh` number (not
     * a CSS string) so a caller can compose it into a `calc()` or a test can
     * compare it as a plain number. */
    heatCardsMaxHeightVh: number;
}

/**
 * What a screen of this size may afford to show.
 *
 * Row *count* on the Standings table itself is deliberately not this
 * module's job even though it is the other half of "density" —
 * `useMeasuredPages` already measures a container's real height and pages
 * through whatever does not fit, which is the actual answer to "how many
 * rows fit" (a fixed guess here could only disagree with it). This module is
 * left with the properties that genuinely depend on the viewport alone:
 * whether a second line of text under a name is worth its row, how many
 * heat cards the row above the table can afford to show, and how much of
 * the screen that row may ever take.
 */
export function densityFor(viewportWidth: number, viewportHeight: number): DisplayDensity {
    const onDeckDepth: DisplayDensity['onDeckDepth'] =
        viewportHeight < ON_DECK_MIN_HEIGHT_PX ? 0 : viewportWidth >= AFTER_THAT_MIN_WIDTH_PX ? 2 : 1;
    return {
        showSecondaryText: viewportWidth >= SECONDARY_TEXT_MIN_WIDTH_PX,
        onDeckDepth,
        heatCardsMaxHeightVh: HEAT_CARDS_BUDGET_VH,
    };
}
