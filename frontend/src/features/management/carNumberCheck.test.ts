import { describe, expect, it } from 'vitest';
import { duplicateCarNumberNotice } from './carNumberCheck';

const roster = [
    { id: 1, first_name: 'Jordan', last_name: 'Mitchell', car_number: 12 },
    { id: 2, first_name: 'Ada', last_name: 'Ant', car_number: 7 },
    { id: 3, first_name: 'Sam', last_name: 'Speedy', car_number: undefined },
];

describe('duplicateCarNumberNotice', () => {
    it('says nothing when nobody has typed a number yet', () => {
        expect(duplicateCarNumberNotice(undefined, roster)).toBeNull();
    });

    it('says nothing about a number nobody else holds', () => {
        expect(duplicateCarNumberNotice(99, roster)).toBeNull();
    });

    it('names the racer who already holds the typed number', () => {
        expect(duplicateCarNumberNotice(12, roster)).toContain('Jordan Mitchell');
    });

    it('excludes the racer being edited, so their own number does not warn about itself', () => {
        expect(duplicateCarNumberNotice(12, roster, 1)).toBeNull();
    });

    it('still warns if a *different* racer holds the number, even while editing one', () => {
        expect(duplicateCarNumberNotice(7, roster, 1)).toContain('Ada Ant');
    });

    it('names every holder when more than one racer already shares the number', () => {
        const dup = [
            ...roster,
            { id: 4, first_name: 'Robin', last_name: 'Racer', car_number: 12 },
        ];
        const notice = duplicateCarNumberNotice(12, dup);
        expect(notice).toContain('Jordan Mitchell');
        expect(notice).toContain('Robin Racer');
    });
});
