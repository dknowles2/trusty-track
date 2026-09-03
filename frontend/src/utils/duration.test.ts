import { describe, expect, it } from 'vitest';
import { heatsEstimate, minutesEstimate } from './duration';

describe('the schedule estimate', () => {
    it('says "min" for one', () => {
        // The commonest number on screen, and the one all four call sites got
        // wrong: the operator screen shows it for the whole of the last heat of
        // every round.
        expect(minutesEstimate(1)).toBe('~1 min');
    });

    it('says "mins" for anything else', () => {
        expect(minutesEstimate(0)).toBe('~0 mins');
        expect(minutesEstimate(2)).toBe('~2 mins');
        expect(minutesEstimate(18)).toBe('~18 mins');
    });

    it('rounds a part-heat up rather than down, against the default baseline', () => {
        // Half a heat of racing left is still someone standing at the track.
        // 0.5 * 1.75 = 0.875, which still rounds up to a whole minute.
        expect(heatsEstimate(0.5)).toBe('~1 min');
    });

    it('uses the 1.75-minute baseline when no pace is supplied', () => {
        // #591: a bare 1 minute is only the time on the track, not the
        // staging and reset around it.
        expect(heatsEstimate(1)).toBe('~2 mins');
        expect(heatsEstimate(18)).toBe('~32 mins');
    });

    it('counts a heat as a heat once a pace is given explicitly', () => {
        expect(heatsEstimate(1, 1)).toBe('~1 min');
        expect(heatsEstimate(18, 1)).toBe('~18 mins');
    });

    it('takes a learned pace over the baseline', () => {
        // A race running faster than the baseline reports the faster number.
        expect(heatsEstimate(4, 1.2)).toBe('~5 mins');
    });
});
