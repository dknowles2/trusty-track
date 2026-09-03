import { describe, it, expect } from 'vitest';
import { raceNameConfirmed } from './deleteConfirmation';

describe('raceNameConfirmed', () => {
    it('matches the exact name', () => {
        expect(raceNameConfirmed('2026 Pinewood Derby', '2026 Pinewood Derby')).toBe(true);
    });

    it('trims surrounding whitespace off what was typed', () => {
        expect(raceNameConfirmed('  2026 Pinewood Derby  ', '2026 Pinewood Derby')).toBe(true);
    });

    it('does not trim whitespace inside the race name itself', () => {
        expect(raceNameConfirmed('2026  Pinewood Derby', '2026 Pinewood Derby')).toBe(false);
    });

    it('is case-sensitive', () => {
        expect(raceNameConfirmed('2026 pinewood derby', '2026 Pinewood Derby')).toBe(false);
    });

    it('rejects a partial match', () => {
        expect(raceNameConfirmed('2026 Pinewood', '2026 Pinewood Derby')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(raceNameConfirmed('', '2026 Pinewood Derby')).toBe(false);
    });

    it('rejects whitespace-only input against a whitespace-only name', () => {
        // A degenerate case, but trimming an all-whitespace name would make an
        // empty box "confirm" a race literally named a single space.
        expect(raceNameConfirmed('   ', ' ')).toBe(false);
    });
});
