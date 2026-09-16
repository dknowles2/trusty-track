import { describe, expect, it } from 'vitest';
import { scaleFor } from './sheetScale';

describe('scaleFor', () => {
    it('never scales above 1 — a wide container leaves the sheet at its true size', () => {
        expect(scaleFor(1200, 560)).toBe(1);
    });

    it('shrinks to fit a container narrower than the sheet', () => {
        // A 390px phone against a 560px sheet — the shape of #1142's own
        // report.
        expect(scaleFor(390, 560)).toBeCloseTo(390 / 560, 10);
    });

    it('is exactly 1 when the container matches the sheet', () => {
        expect(scaleFor(560, 560)).toBe(1);
    });

    it.each([
        [0, 560],
        [-10, 560],
        [390, 0],
        [390, -10],
    ])('treats an unmeasured dimension (%d, %d) as "not scaled yet" rather than "shrink to nothing"', (c, n) => {
        expect(scaleFor(c, n)).toBe(1);
    });
});
