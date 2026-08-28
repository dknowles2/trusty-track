import { describe, expect, it } from 'vitest';
import { formatOunces, weightNotice, weightVerdict } from './weightCheck';

describe('weightVerdict', () => {
    it('says nothing about a race that does not check weights', () => {
        // Which is every race created before this existed.
        expect(weightVerdict(9.9, null)).toBe('NO_LIMIT');
    });

    it('does not judge a car nobody has weighed', () => {
        expect(weightVerdict(null, 5)).toBe('NOT_WEIGHED');
        expect(weightVerdict(undefined, 5)).toBe('NOT_WEIGHED');
    });

    it('treats an empty field as unweighed rather than as a very light car', () => {
        // The number input hands back 0 for an empty box, and a green tick
        // against a car nobody has put on the scale is worse than no answer.
        expect(weightVerdict(0, 5)).toBe('NOT_WEIGHED');
    });

    it('passes a car under the limit', () => {
        expect(weightVerdict(4.9, 5)).toBe('UNDER');
    });

    it('passes a car exactly on the limit', () => {
        expect(weightVerdict(5, 5)).toBe('UNDER');
    });

    it('passes a car a hundredth over, because scales disagree', () => {
        // Refusing 5.001 is a rule about the equipment rather than about the
        // car.
        expect(weightVerdict(5.001, 5)).toBe('UNDER');
    });

    it('passes a car at exactly the tolerance boundary', () => {
        // TOLERANCE_OZ is chosen precisely so a car reading limit + 0.005
        // still passes — this is the value the constant exists for, not a
        // value comfortably inside or outside it.
        expect(weightVerdict(5.005, 5)).toBe('UNDER');
    });

    it('flags a car the desk scale can actually distinguish', () => {
        // 5.01 is the smallest step a two-decimal scale shows above 5.00.
        expect(weightVerdict(5.01, 5)).toBe('OVER');
    });

    it('flags a car well over', () => {
        expect(weightVerdict(5.4, 5)).toBe('OVER');
    });

    it('respects a pack that sets its own limit', () => {
        expect(weightVerdict(5.2, 5.5)).toBe('UNDER');
        expect(weightVerdict(5.2, 5)).toBe('OVER');
    });
});

describe('weightNotice', () => {
    it('names the limit, so the number is not a mystery', () => {
        expect(weightNotice('OVER', 5)).toBe('Over the 5 oz limit for this race.');
    });

    it('says nothing about a car that passed', () => {
        expect(weightNotice('UNDER', 5)).toBeNull();
    });

    it('says nothing when there is no limit', () => {
        expect(weightNotice('NO_LIMIT', null)).toBeNull();
    });

    it('says nothing about a car nobody weighed', () => {
        expect(weightNotice('NOT_WEIGHED', 5)).toBeNull();
    });
});

describe('formatOunces', () => {
    it('drops the trailing zeroes on a round limit', () => {
        expect(formatOunces(5)).toBe('5');
    });

    it('keeps a limit that is not round', () => {
        expect(formatOunces(5.25)).toBe('5.25');
    });
});
