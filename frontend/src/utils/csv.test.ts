import { describe, expect, it } from 'vitest';
import { csvField, filenameFor, toCsv } from './csv';

describe('csvField', () => {
    it('quotes every field', () => {
        expect(csvField('Ada')).toBe('"Ada"');
        expect(csvField(3)).toBe('"3"');
    });

    it('doubles an embedded quote', () => {
        // The bug in the original: a car named `The "Beast"` produced
        // `"The "Beast""`, which is malformed from that field onwards and
        // silently shifts every later column in a spreadsheet.
        expect(csvField('The "Beast"')).toBe('"The ""Beast"""');
    });

    it('writes null and undefined as empty rather than the word', () => {
        expect(csvField(null)).toBe('""');
        expect(csvField(undefined)).toBe('""');
    });

    it('leaves a comma alone inside the quotes', () => {
        expect(csvField('Lovelace, Ada')).toBe('"Lovelace, Ada"');
    });

    it('keeps a zero, rather than treating it as absent', () => {
        // `value ?? ''` is deliberate: `||` would turn a time of 0 into an
        // empty cell, and 0 is a real recorded time (the DNF penalty).
        expect(csvField(0)).toBe('"0"');
    });
});

describe('toCsv', () => {
    it('joins fields with commas and rows with CRLF', () => {
        expect(
            toCsv([
                ['Car #', 'Name'],
                [3, 'Ada'],
            ]),
        ).toBe('"Car #","Name"\r\n"3","Ada"');
    });

    it('survives a field containing a newline', () => {
        const csv = toCsv([['a\nb']]);
        expect(csv).toBe('"a\nb"');
    });

    it('produces nothing for no rows', () => {
        expect(toCsv([])).toBe('');
    });
});

describe('filenameFor', () => {
    it('appends the suffix', () => {
        expect(filenameFor('Pack 42 Derby', 'standings')).toBe('Pack 42 Derby-standings.csv');
    });

    it('replaces a slash, which browsers disagree about in a download name', () => {
        expect(filenameFor('Pack 42 / Den 3', 'standings')).toBe(
            'Pack 42 - Den 3-standings.csv',
        );
    });

    it('replaces every separator rather than dropping the name', () => {
        expect(filenameFor('///', 'standings')).toBe('----standings.csv');
    });

    it('falls back when there is no name at all', () => {
        // `a.download` with a leading dash or an empty stem is a filename the
        // operator has to rename before they can find it again.
        expect(filenameFor('   ', 'standings')).toBe('race-standings.csv');
        expect(filenameFor('', 'standings')).toBe('race-standings.csv');
    });
});
