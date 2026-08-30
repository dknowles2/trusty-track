/**
 * Turning three booleans off `TimerStatus` into what the timer check page
 * shows (#553).
 *
 * These three — indicatesTimingStarted, hasCountdownClock,
 * hasPhotoFinishTrigger — are plain datasheet claims about the connected
 * model, the same shape as `deviceProvenance`: most of these profiles have
 * never run against real hardware, so the label says "the model claims",
 * never "this device does". Pure and tested for the same reason every other
 * label-building rule here is (`awardText.ts`, `ceremony.ts`): the wording is
 * the part worth pinning, not the JSX around it.
 */

export interface TimerCapabilityStatus {
    indicatesTimingStarted: boolean;
    hasCountdownClock: boolean;
    hasPhotoFinishTrigger: boolean;
}

export interface TimerCapability {
    key: string;
    label: string;
}

/** Every capability the connected model claims, in a fixed display order. */
export function claimedCapabilities(status: TimerCapabilityStatus): TimerCapability[] {
    const claims: TimerCapability[] = [];
    if (status.indicatesTimingStarted) {
        claims.push({ key: 'timing-started', label: 'Indicates timing started' });
    }
    if (status.hasCountdownClock) {
        claims.push({ key: 'countdown-clock', label: 'Countdown clock' });
    }
    if (status.hasPhotoFinishTrigger) {
        claims.push({ key: 'photo-finish-trigger', label: 'Photo-finish trigger' });
    }
    return claims;
}
