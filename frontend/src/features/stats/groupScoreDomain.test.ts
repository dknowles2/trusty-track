import { describe, it, expect } from 'vitest';
import { groupScoreDomain } from './groupScoreDomain';

describe('groupScoreDomain', () => {
    it('returns [0, "auto"] when input list is empty', () => {
        expect(groupScoreDomain([])).toEqual([0, 'auto']);
    });

    it('returns [0, "auto"] when all scores are null or non-positive', () => {
        expect(groupScoreDomain([{ avgScore: null }, { avgScore: 0 }])).toEqual([0, 'auto']);
    });

    it('pads tightly around average scores so small differences are distinguishable', () => {
        // Range 3.36 to 3.74: spread = 0.38, pad = max(0.1, 0.057) = 0.1
        // dMin = floor((3.36 - 0.1) * 10) / 10 = 3.2
        // dMax = ceil((3.74 + 0.1) * 10) / 10 = 3.9
        expect(groupScoreDomain([{ avgScore: 3.36 }, { avgScore: 3.74 }])).toEqual([3.2, 3.9]);
    });

    it('handles identical non-null scores with minimum padding', () => {
        // min = max = 3.5, spread = 0, pad = 0.1
        // dMin = floor(3.4 * 10) / 10 = 3.4
        // dMax = ceil(3.6 * 10) / 10 = 3.6
        expect(groupScoreDomain([{ avgScore: 3.5 }, { avgScore: 3.5 }])).toEqual([3.4, 3.6]);
    });
});
