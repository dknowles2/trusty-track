import { describe, expect, it } from 'vitest';
import { advancingFromLabel, skippedHeatWarning } from './roundSummaryText';

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

describe('skippedHeatWarning', () => {
    it('names the heat and offers to run it, with a re-pick clause for the round summary', () => {
        expect(skippedHeatWarning(6, 'cars', true)).toBe(
            'Heat 6 was skipped. Run it first if the cars have turned up — the next round will re-pick.',
        );
    });

    it('drops the re-pick clause for the race summary, which has no next round to name', () => {
        expect(skippedHeatWarning(6, 'cars', false)).toBe(
            'Heat 6 was skipped. Run it first if the cars have turned up.',
        );
    });

    it('uses the resolved vehicle word for an install that renamed it', () => {
        expect(skippedHeatWarning(3, 'rockets', true)).toBe(
            'Heat 3 was skipped. Run it first if the rockets have turned up — the next round will re-pick.',
        );
    });
});
