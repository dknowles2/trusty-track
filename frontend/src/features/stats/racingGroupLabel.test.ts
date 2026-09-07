import { describe, expect, it } from 'vitest';
import { shouldShowDivision } from './racingGroupLabel';

describe('shouldShowDivision', () => {
    it('shows a division that adds information', () => {
        // "Wolves" the den, "Wolf" the rank — not the same word.
        expect(shouldShowDivision('Wolves', 'Wolf')).toBe(true);
    });

    it('hides a division that only repeats the group name (#774)', () => {
        // The setup wizard's Cub Scout scaffold names a den "Bear" with
        // Category "Bear" — every rank preset does the same — so the
        // Standings page must not print "Bear (Bear)" on every row.
        expect(shouldShowDivision('Bear', 'Bear')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(shouldShowDivision('Bear', 'bear')).toBe(false);
        expect(shouldShowDivision('ARROW OF LIGHT', 'Arrow of Light')).toBe(false);
    });

    it('ignores surrounding whitespace', () => {
        expect(shouldShowDivision('Bear', ' Bear ')).toBe(false);
    });

    it('hides nothing when there is no division', () => {
        expect(shouldShowDivision('Bear', null)).toBe(false);
        expect(shouldShowDivision('Bear', undefined)).toBe(false);
        expect(shouldShowDivision('Bear', '')).toBe(false);
    });
});
