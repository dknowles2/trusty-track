import { describe, expect, it } from 'vitest';
import { formatScaleMph, scaleSpeedNeedsATimerNote } from './scaleSpeed';

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

describe('scaleSpeedNeedsATimerNote (#1329 gap 3)', () => {
    it('names a track with no electronic timer', () => {
        expect(scaleSpeedNeedsATimerNote('NONE')).toContain('no electronic timer');
    });

    it('is absent for every real or fake timer type', () => {
        for (const timerType of ['FAKE', 'AUTO_DETECT_BACKEND', 'AUTO_DETECT_PROXY']) {
            expect(scaleSpeedNeedsATimerNote(timerType)).toBeNull();
        }
    });

    it('is absent when the timer type has not answered yet', () => {
        expect(scaleSpeedNeedsATimerNote(null)).toBeNull();
        expect(scaleSpeedNeedsATimerNote(undefined)).toBeNull();
    });
});
