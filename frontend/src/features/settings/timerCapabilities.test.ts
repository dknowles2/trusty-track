import { describe, expect, it } from 'vitest';
import { claimedCapabilities } from './timerCapabilities';

describe('claimedCapabilities', () => {
    it('lists nothing when the model claims nothing', () => {
        expect(
            claimedCapabilities({
                indicatesTimingStarted: false,
                hasCountdownClock: false,
                hasPhotoFinishTrigger: false,
            }),
        ).toEqual([]);
    });

    it('lists every claim in a fixed order, regardless of which are set', () => {
        expect(
            claimedCapabilities({
                indicatesTimingStarted: true,
                hasCountdownClock: false,
                hasPhotoFinishTrigger: true,
            }),
        ).toEqual([
            { key: 'timing-started', label: 'Indicates timing started' },
            { key: 'photo-finish-trigger', label: 'Photo-finish trigger' },
        ]);
    });

    it('lists all three when every claim is set', () => {
        const claims = claimedCapabilities({
            indicatesTimingStarted: true,
            hasCountdownClock: true,
            hasPhotoFinishTrigger: true,
        });
        expect(claims.map((c) => c.key)).toEqual([
            'timing-started',
            'countdown-clock',
            'photo-finish-trigger',
        ]);
    });
});
