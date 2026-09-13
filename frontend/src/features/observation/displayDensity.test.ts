import { describe, expect, it } from 'vitest';
import { densityFor } from './displayDensity';

/**
 * The four viewports `displayResolutions.spec.ts` and `CLAUDE.md`'s own
 * table name: 800×600 (SVGA, the floor) and 1024×768 (XGA) sit either side
 * of the threshold below, 1280×720 and 1920×1080 sit above it.
 */
describe('densityFor', () => {
    it('drops the secondary line below the threshold (800px wide — SVGA)', () => {
        expect(densityFor(800).showSecondaryText).toBe(false);
    });

    it('drops the secondary line one pixel under the threshold', () => {
        expect(densityFor(1023).showSecondaryText).toBe(false);
    });

    it('keeps the secondary line exactly at the threshold (1024px wide — XGA)', () => {
        expect(densityFor(1024).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line above the threshold (1280px wide — 720p)', () => {
        expect(densityFor(1280).showSecondaryText).toBe(true);
    });

    it('keeps the secondary line well above the threshold (1920px wide)', () => {
        expect(densityFor(1920).showSecondaryText).toBe(true);
    });

    it('drops "After That" below the threshold (800px wide — SVGA)', () => {
        expect(densityFor(800).onDeckDepth).toBe(1);
    });

    it('drops "After That" one pixel under the threshold', () => {
        expect(densityFor(1023).onDeckDepth).toBe(1);
    });

    it('keeps "After That" exactly at the threshold (1024px wide — XGA)', () => {
        expect(densityFor(1024).onDeckDepth).toBe(2);
    });

    it('keeps "After That" above the threshold (1280px wide — 720p)', () => {
        expect(densityFor(1280).onDeckDepth).toBe(2);
    });

    it('keeps "After That" well above the threshold (1920px wide)', () => {
        expect(densityFor(1920).onDeckDepth).toBe(2);
    });
});
