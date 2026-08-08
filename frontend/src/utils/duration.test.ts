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

    it('rounds a part-heat up rather than down', () => {
        // Half a heat of racing left is still someone standing at the track.
        expect(heatsEstimate(0.5)).toBe('~1 min');
    });

    it('counts a heat as a heat', () => {
        expect(heatsEstimate(1)).toBe('~1 min');
        expect(heatsEstimate(18)).toBe('~18 mins');
    });
});
