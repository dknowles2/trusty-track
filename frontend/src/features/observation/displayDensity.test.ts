import { describe, expect, it } from 'vitest';
import { densityFor } from './displayDensity';

/**
 * The four viewports `displayResolutions.spec.ts` and `CLAUDE.md`'s own
 * table name: 800×600 (SVGA, the floor) and 1024×768 (XGA) sit either side
 * of the width threshold below; 1280×720 and 1920×1080 sit above it. Height
 * pairs 600 with the SVGA floor's own on-deck depth drop; 700 and up (XGA's
 * 768, 720p's own 720, 1080p) keep it. Lane count is a third dimension
 * (#1073's own follow-up review) — 6 is this file's original tested case,
 * 8 is `Track.lane_count`'s own ceiling.
 */
describe('densityFor', () => {
    it('drops the secondary line below the width threshold (800px wide — SVGA)', () => {
        expect(densityFor(800, 600, 6).showSecondaryText).toBe(false);
    });

    it('drops the secondary line one pixel under the width threshold', () => {
        expect(densityFor(1023, 768, 6).showSecondaryText).toBe(false);
    });

    it('keeps the secondary line exactly at the width threshold (1024px wide — XGA)', () => {
        expect(densityFor(1024, 768, 6).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line above the width threshold (1280px wide — 720p)', () => {
        expect(densityFor(1280, 720, 6).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line well above the width threshold (1920px wide)', () => {
        expect(densityFor(1920, 1080, 6).showSecondaryText).toBe(true);
    });

    it('drops to Now Racing only at the SVGA floor (800×600)', () => {
        expect(densityFor(800, 600, 6).onDeckDepth).toBe(0);
    });

    it('keeps On Deck but not After That at the XGA floor (1024×768) — three cards do not fit one row there', () => {
        expect(densityFor(1024, 768, 6).onDeckDepth).toBe(1);
    });

    it('keeps On Deck but not After That one pixel under the on-deck-depth width threshold', () => {
        expect(densityFor(1099, 768, 6).onDeckDepth).toBe(1);
    });

    it('keeps After That exactly at the on-deck-depth width threshold, once height clears its own (1100×768)', () => {
        expect(densityFor(1100, 768, 6).onDeckDepth).toBe(2);
    });

    it('keeps After That above the width threshold (1280×720 — 720p)', () => {
        expect(densityFor(1280, 720, 6).onDeckDepth).toBe(2);
    });

    it('keeps After That well above the width threshold (1920×1080)', () => {
        expect(densityFor(1920, 1080, 6).onDeckDepth).toBe(2);
    });

    it('drops to Now Racing only one pixel under the height threshold, regardless of width', () => {
        expect(densityFor(1920, 699, 6).onDeckDepth).toBe(0);
    });

    it('keeps On Deck at the height threshold, subject to the width rule (1920×700)', () => {
        expect(densityFor(1920, 700, 6).onDeckDepth).toBe(2);
    });

    it('reports the same heat-cards budget regardless of viewport or lane count, since it is a ceiling, not a target', () => {
        expect(densityFor(800, 600, 6).heatCardsMaxHeightVh).toBe(densityFor(1920, 1080, 8).heatCardsMaxHeightVh);
        expect(densityFor(800, 600, 6).heatCardsMaxHeightVh).toBeGreaterThan(0);
    });

    describe('heatCardCompactness — tiered by the track lane count alone, independent of viewport', () => {
        it('is 0 (the original, least compact sizing) at 2 lanes or fewer', () => {
            expect(densityFor(1920, 1080, 1).heatCardCompactness).toBe(0);
            expect(densityFor(1920, 1080, 2).heatCardCompactness).toBe(0);
        });

        it('is 1 at 3-4 lanes', () => {
            expect(densityFor(1920, 1080, 3).heatCardCompactness).toBe(1);
            expect(densityFor(1920, 1080, 4).heatCardCompactness).toBe(1);
        });

        it('is 2 at 5-6 lanes — the original tested case', () => {
            expect(densityFor(1920, 1080, 5).heatCardCompactness).toBe(2);
            expect(densityFor(1920, 1080, 6).heatCardCompactness).toBe(2);
        });

        it('is 3 above 6 lanes — an 8-lane track, Track.lane_count own ceiling', () => {
            expect(densityFor(1920, 1080, 7).heatCardCompactness).toBe(3);
            expect(densityFor(1920, 1080, 8).heatCardCompactness).toBe(3);
        });

        it('does not vary with viewport size, only lane count', () => {
            expect(densityFor(800, 600, 8).heatCardCompactness).toBe(densityFor(1920, 1080, 8).heatCardCompactness);
        });
    });

    describe('onDeckDepth drops "After That" past a lane-count ceiling, even where width and height alone would keep it', () => {
        it('keeps After That at 1280×720 for a 6-lane track (the original tested case)', () => {
            expect(densityFor(1280, 720, 6).onDeckDepth).toBe(2);
        });

        it('drops to On Deck only at 1280×720 for a 7-lane track — one past the ceiling', () => {
            expect(densityFor(1280, 720, 7).onDeckDepth).toBe(1);
        });

        it('drops to On Deck only at 1280×720 for an 8-lane track — Track.lane_count own ceiling', () => {
            expect(densityFor(1280, 720, 8).onDeckDepth).toBe(1);
        });

        it('still drops to Now Racing only below the height threshold regardless of lane count', () => {
            expect(densityFor(1920, 600, 8).onDeckDepth).toBe(0);
        });

        it('keeps the lane-count ceiling from ever promoting a depth width/height alone would not allow', () => {
            // A narrow viewport already caps depth at 1 or 0; a low lane count
            // must not raise it back to 2.
            expect(densityFor(1024, 768, 2).onDeckDepth).toBe(1);
        });
    });

    // #1143: the projector's own two-column layout leaves Current Standings
    // partially or entirely off-screen on a portrait tablet — 820×1180 is
    // the case the issue found (`.projector-right-col`'s own `right`
    // measured at 978 against an 820px-wide viewport).
    describe('projectorStacked', () => {
        it('stacks on a portrait tablet (820×1180, this issue\'s own case)', () => {
            expect(densityFor(820, 1180, 6).projectorStacked).toBe(true);
        });

        it('stacks on a smaller portrait tablet (768×1024)', () => {
            expect(densityFor(768, 1024, 6).projectorStacked).toBe(true);
        });

        it('does not stack a landscape viewport of the identical width (1180×820) — only 8px away from clipping, not portrait', () => {
            expect(densityFor(1180, 820, 6).projectorStacked).toBe(false);
        });

        it('does not stack the tested SVGA floor (800×600), even though 800 < 1000 — its aspect ratio (1.33) is nowhere near portrait', () => {
            expect(densityFor(800, 600, 6).projectorStacked).toBe(false);
        });

        it('does not stack any of the other three tested landscape viewports', () => {
            expect(densityFor(1024, 768, 6).projectorStacked).toBe(false);
            expect(densityFor(1280, 720, 6).projectorStacked).toBe(false);
            expect(densityFor(1920, 1080, 6).projectorStacked).toBe(false);
        });

        it('treats a perfectly square viewport as not stacked — aspect ratio 1 is the boundary, not included', () => {
            expect(densityFor(900, 900, 6).projectorStacked).toBe(false);
        });
    });

    describe('projectorHeatCardsSideBySide', () => {
        it('keeps Now Racing and On Deck side by side at both of this issue\'s own portrait-tablet widths', () => {
            expect(densityFor(820, 1180, 6).projectorHeatCardsSideBySide).toBe(true);
            expect(densityFor(768, 1024, 6).projectorHeatCardsSideBySide).toBe(true);
        });

        it('stacks them instead below the 700px floor #1144 owns', () => {
            expect(densityFor(430, 900, 6).projectorHeatCardsSideBySide).toBe(false);
        });
    });

    it('projectorHeatCardsMaxHeightVh is a fixed budget, not derived from the viewport', () => {
        expect(densityFor(820, 1180, 6).projectorHeatCardsMaxHeightVh).toBe(
            densityFor(768, 1024, 8).projectorHeatCardsMaxHeightVh,
        );
    });
});
