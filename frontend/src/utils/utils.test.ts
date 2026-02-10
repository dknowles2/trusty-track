import { describe, it, expect } from 'vitest';
import { COMMON_COLORS, getContrastColor } from './colors';
import { getDeterministicColor, getInitials } from './avatarUtils';

describe('colors utils', () => {
    it('getContrastColor returns correct contrast', () => {
        expect(getContrastColor('#000000')).toBe('white'); // Black -> White text
        expect(getContrastColor('#FFFFFF')).toBe('black'); // White -> Black text
        expect(getContrastColor('#FCD116')).toBe('black'); // Gold (Bright) -> Black text
        expect(getContrastColor('#003F87')).toBe('white'); // Blue (Dark) -> White text
    });
});

describe('avatarUtils', () => {
    it('getDeterministicColor returns consistent color for same ID', () => {
        const id = 123;
        const color1 = getDeterministicColor(id);
        const color2 = getDeterministicColor(id);
        expect(color1).toBe(color2);
        expect(COMMON_COLORS).toContain(color1);
    });

    it('getDeterministicColor returns consistent color for same string', () => {
        const str = "test-string";
        const color1 = getDeterministicColor(str);
        const color2 = getDeterministicColor(str);
        expect(color1).toBe(color2);
        expect(COMMON_COLORS).toContain(color1);
    });

    it('getInitials extracts initials correctly', () => {
        expect(getInitials('John', 'Doe')).toBe('JD');
        expect(getInitials('Jane')).toBe('J');
        expect(getInitials('alpha', 'beta')).toBe('AB');
        expect(getInitials('', 'Smith')).toBe('S');
    });
});
