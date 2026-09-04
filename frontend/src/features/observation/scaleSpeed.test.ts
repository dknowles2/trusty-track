import { describe, expect, it } from 'vitest';
import { formatScaleMph } from './scaleSpeed';

describe('formatScaleMph', () => {
    it('renders a whole number of mph', () => {
        expect(formatScaleMph(213.1)).toBe('213 mph');
    });

    it('rounds rather than truncates', () => {
        expect(formatScaleMph(213.6)).toBe('214 mph');
    });

    it('renders zero as a number rather than nothing', () => {
        expect(formatScaleMph(0.4)).toBe('0 mph');
    });

    it('is null when the value is null', () => {
        expect(formatScaleMph(null)).toBeNull();
    });

    it('is null when the value is undefined', () => {
        expect(formatScaleMph(undefined)).toBeNull();
    });
});
