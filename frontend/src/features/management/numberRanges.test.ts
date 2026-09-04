import { describe, expect, it } from 'vitest';
import { suggestedRange } from './numberRanges';

describe('suggestedRange', () => {
    it('offers the first block of a hundred when there are no groups', () => {
        expect(suggestedRange([])).toEqual({ start: 100, end: 199 });
    });

    it('offers the first block when no group has a range', () => {
        expect(suggestedRange([{ car_number_range_end: null }, {}])).toEqual({ start: 100, end: 199 });
    });

    it('offers the block after the highest range in use', () => {
        expect(suggestedRange([{ car_number_range_end: 199 }])).toEqual({ start: 200, end: 299 });
    });

    it('rounds a range ending mid-block up to the next round hundred', () => {
        expect(suggestedRange([{ car_number_range_end: 150 }])).toEqual({ start: 200, end: 299 });
        expect(suggestedRange([{ car_number_range_end: 200 }])).toEqual({ start: 300, end: 399 });
    });
});
