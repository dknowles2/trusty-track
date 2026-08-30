import { describe, expect, it } from 'vitest';
import { formatDisplayName, shouldShowRacerPhoto } from './displayName';

describe('formatDisplayName', () => {
    describe('FULL', () => {
        it('prints the whole name', () => {
            expect(formatDisplayName('FULL', 'Jordan', 'Mitchell')).toBe('Jordan Mitchell');
        });

        it('prints just the first name when there is no last name', () => {
            expect(formatDisplayName('FULL', 'Jordan', '')).toBe('Jordan');
        });

        it('is also what an unrecognised value falls back to', () => {
            expect(formatDisplayName('SOMETHING_ELSE', 'Jordan', 'Mitchell')).toBe(
                'Jordan Mitchell',
            );
        });
    });

    describe('LAST_INITIAL', () => {
        it('prints the first name and last initial', () => {
            expect(formatDisplayName('LAST_INITIAL', 'Jordan', 'Mitchell')).toBe('Jordan M.');
        });

        it('falls back to the first name alone for a single-word name', () => {
            expect(formatDisplayName('LAST_INITIAL', 'Jordan', '')).toBe('Jordan');
        });

        it('prints the bare initial when there is no first name', () => {
            expect(formatDisplayName('LAST_INITIAL', '', 'Mitchell')).toBe('M.');
        });

        it('initials on the first letter of a hyphenated surname', () => {
            // Not the final word's initial ("L.") — the surname's own first
            // letter, matching how a person abbreviates their own name.
            expect(formatDisplayName('LAST_INITIAL', 'Jordan', 'Garcia-Lopez')).toBe(
                'Jordan G.',
            );
        });

        it('initials on the first letter of a multi-part surname', () => {
            expect(formatDisplayName('LAST_INITIAL', 'Jordan', 'de la Cruz')).toBe(
                'Jordan D.',
            );
        });

        it('trims surrounding whitespace before initialing', () => {
            expect(formatDisplayName('LAST_INITIAL', ' Jordan ', ' Mitchell ')).toBe(
                'Jordan M.',
            );
        });
    });

    describe('FIRST_ONLY', () => {
        it('prints just the first name', () => {
            expect(formatDisplayName('FIRST_ONLY', 'Jordan', 'Mitchell')).toBe('Jordan');
        });

        it('falls back to the last name when there is no first name', () => {
            // Printing nothing identifies nobody; the roster row still has a
            // name, just entered surname-first.
            expect(formatDisplayName('FIRST_ONLY', '', 'Mitchell')).toBe('Mitchell');
        });

        it('is empty only when the racer has no name at all', () => {
            expect(formatDisplayName('FIRST_ONLY', '', '')).toBe('');
        });
    });
});

describe('shouldShowRacerPhoto', () => {
    it('shows the photo under FULL', () => {
        expect(shouldShowRacerPhoto('FULL')).toBe(true);
    });

    it('hides the photo under LAST_INITIAL', () => {
        expect(shouldShowRacerPhoto('LAST_INITIAL')).toBe(false);
    });

    it('hides the photo under FIRST_ONLY', () => {
        expect(shouldShowRacerPhoto('FIRST_ONLY')).toBe(false);
    });
});
