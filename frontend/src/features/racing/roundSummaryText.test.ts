import { describe, expect, it } from 'vitest';
import { advancingFromLabel } from './roundSummaryText';

const DEFAULT_WORDS = { orgLower: 'pack', groupLower: 'den' };

describe('advancingFromLabel', () => {
    it('names the whole organization for an ALL source, in the built-in words', () => {
        expect(advancingFromLabel('ALL', DEFAULT_WORDS)).toBe('the whole pack');
    });

    it('names the racing group for an EACH_GROUP source, in the built-in words', () => {
        // Not "each racing group" — that is the internal source vocabulary,
        // not a word an operator has ever configured or read (#532).
        expect(advancingFromLabel('EACH_GROUP', DEFAULT_WORDS)).toBe('each den');
    });

    it('calls a round source "an earlier round"', () => {
        expect(advancingFromLabel('ROUND:4', DEFAULT_WORDS)).toBe('an earlier round');
    });

    it('falls back to "an earlier round" for a null or missing source', () => {
        expect(advancingFromLabel(null, DEFAULT_WORDS)).toBe('an earlier round');
        expect(advancingFromLabel(undefined, DEFAULT_WORDS)).toBe('an earlier round');
    });

    it('uses the resolved words for an install that renamed them', () => {
        expect(advancingFromLabel('ALL', { orgLower: 'troop', groupLower: 'patrol' })).toBe(
            'the whole troop',
        );
        expect(advancingFromLabel('EACH_GROUP', { orgLower: 'troop', groupLower: 'patrol' })).toBe(
            'each patrol',
        );
    });
});
