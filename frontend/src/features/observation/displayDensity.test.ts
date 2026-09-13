import { describe, expect, it } from 'vitest';
import { densityFor } from './displayDensity';

/**
 * The four viewports `displayResolutions.spec.ts` and `CLAUDE.md`'s own
 * table name: 800×600 (SVGA, the floor) and 1024×768 (XGA) sit either side
 * of the secondary-text width threshold (1024px); both sit *under* the
 * on-deck-depth width threshold (1100px, once a card's own padding is
 * counted against the 300px `minWidth` floor three of them need to share a
 * row — see `AFTER_THAT_MIN_WIDTH_PX`'s own comment), which only 1280×720
 * and 1920×1080 clear. Height pairs 600 with the SVGA floor's own on-deck
 * depth drop; 700 and up (XGA's 768, 720p's own 720, 1080p) keep it.
 */
describe('densityFor', () => {
    it('drops the secondary line below the width threshold (800px wide — SVGA)', () => {
        expect(densityFor(800, 600).showSecondaryText).toBe(false);
    });

    it('drops the secondary line one pixel under the width threshold', () => {
        expect(densityFor(1023, 768).showSecondaryText).toBe(false);
    });

    it('keeps the secondary line exactly at the width threshold (1024px wide — XGA)', () => {
        expect(densityFor(1024, 768).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line above the width threshold (1280px wide — 720p)', () => {
        expect(densityFor(1280, 720).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line well above the width threshold (1920px wide)', () => {
        expect(densityFor(1920, 1080).showSecondaryText).toBe(true);
    });

    it('drops to Now Racing only at the SVGA floor (800×600)', () => {
        expect(densityFor(800, 600).onDeckDepth).toBe(0);
    });

    it('keeps On Deck but not After That at the XGA floor (1024×768) — three cards do not fit one row there', () => {
        expect(densityFor(1024, 768).onDeckDepth).toBe(1);
    });

    it('keeps On Deck but not After That one pixel under the on-deck-depth width threshold', () => {
        expect(densityFor(1099, 768).onDeckDepth).toBe(1);
    });

    it('keeps After That exactly at the on-deck-depth width threshold, once height clears its own (1100×768)', () => {
        expect(densityFor(1100, 768).onDeckDepth).toBe(2);
    });

    it('keeps After That above the width threshold (1280×720 — 720p)', () => {
        expect(densityFor(1280, 720).onDeckDepth).toBe(2);
    });

    it('keeps After That well above the width threshold (1920×1080)', () => {
        expect(densityFor(1920, 1080).onDeckDepth).toBe(2);
    });

    it('drops to Now Racing only one pixel under the height threshold, regardless of width', () => {
        expect(densityFor(1920, 699).onDeckDepth).toBe(0);
    });

    it('keeps On Deck at the height threshold, subject to the width rule (1920×700)', () => {
        expect(densityFor(1920, 700).onDeckDepth).toBe(2);
    });

    it('reports the same heat-cards budget regardless of viewport, since it is a ceiling, not a target', () => {
        expect(densityFor(800, 600).heatCardsMaxHeightVh).toBe(densityFor(1920, 1080).heatCardsMaxHeightVh);
        expect(densityFor(800, 600).heatCardsMaxHeightVh).toBeGreaterThan(0);
    });
});
