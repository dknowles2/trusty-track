import { describe, expect, it } from 'vitest';
import { RANKS, rankLabel } from './rankText';

describe('rankLabel', () => {
    it('says a rank the way a pack does — the reported bug', () => {
        // The den list showed the stored value, so a den of Arrow of Light
        // scouts read "(ARROW_OF_LIGHT)".
        expect(rankLabel('ARROW_OF_LIGHT')).toBe('Arrow of Light');
        expect(rankLabel('WEBELOS')).toBe('Webelos');
        expect(rankLabel('LION')).toBe('Lion');
    });

    it('says nothing for a den with no rank', () => {
        expect(rankLabel(undefined)).toBe('');
        expect(rankLabel(null)).toBe('');
        expect(rankLabel('')).toBe('');
    });

    it('tidies a rank it has never heard of', () => {
        // A rank added to the backend before this list hears about it should
        // still read as words rather than as an enum.
        expect(rankLabel('SUPER_WOLF')).toBe('Super Wolf');
    });
});

describe('RANKS', () => {
    it('covers every rank the backend stores', () => {
        expect(RANKS.map((rank) => rank.value)).toEqual([
            'LION',
            'TIGER',
            'WOLF',
            'BEAR',
            'WEBELOS',
            'ARROW_OF_LIGHT',
            'OTHER',
        ]);
    });

    it('labels each one, and the labels are what rankLabel gives', () => {
        // One list, so the pickers and the den list cannot disagree — which
        // is what they were doing.
        for (const rank of RANKS) {
            expect(rank.label).toBeTruthy();
            expect(rankLabel(rank.value)).toBe(rank.label);
        }
    });
});
