import { describe, expect, it } from 'vitest';
import {
    scoreHeading,
    scoreValue,
    standingsRows,
    standingsSuffix,
    type StandingsEntry,
} from './standingsExport';

const entry = (over: Partial<StandingsEntry> = {}): StandingsEntry => ({
    rank: 1,
    carNumber: 3,
    firstName: 'Ada',
    lastName: 'Lovelace',
    racingGroupName: 'Wolves',
    score: 3.2016,
    heatsCompleted: 4,
    ...over,
});

describe('the score column', () => {
    it('is named for the scoring strategy', () => {
        // "Score" is unreadable a week later: 4.2 is seconds and 4 is
        // placement points, and once it is a file nothing else says which.
        expect(scoreHeading('TIMED')).toBe('Average Time (s)');
        expect(scoreHeading('POINTS')).toBe('Points');
    });

    it('keeps milliseconds on a time', () => {
        expect(scoreValue(3.2016, 'TIMED')).toBe('3.202');
        expect(scoreValue(3.2, 'TIMED')).toBe('3.200');
    });

    it('leaves points whole', () => {
        expect(scoreValue(7, 'POINTS')).toBe('7');
    });

    it('does not round a time away to nothing', () => {
        expect(scoreValue(0, 'TIMED')).toBe('0.000');
    });
});

describe('standingsRows', () => {
    it('starts with a header naming the strategy', () => {
        const [header] = standingsRows([entry()], 'POINTS');
        expect(header).toEqual([
            'Rank',
            'Car #',
            'First Name',
            'Last Name',
            'Den',
            'Points',
            'Heats',
        ]);
    });

    it('writes one row per racer, in the order given', () => {
        const rows = standingsRows(
            [entry({ rank: 1, lastName: 'Lovelace' }), entry({ rank: 2, lastName: 'Hopper' })],
            'TIMED',
        );
        expect(rows).toHaveLength(3);
        expect(rows[1][3]).toBe('Lovelace');
        expect(rows[2][3]).toBe('Hopper');
    });

    it('keeps a missing car number as empty rather than inventing one', () => {
        const rows = standingsRows([entry({ carNumber: null })], 'TIMED');
        expect(rows[1][1]).toBeNull();
    });

    it('exports nothing but the header for empty standings', () => {
        expect(standingsRows([], 'TIMED')).toHaveLength(1);
    });

    it('names the number column for the resolved words (#551)', () => {
        const [header] = standingsRows([entry()], 'POINTS', 'Class', 'Rocket');
        expect(header).toEqual([
            'Rank',
            'Rocket #',
            'First Name',
            'Last Name',
            'Class',
            'Points',
            'Heats',
        ]);
    });
});

describe('standingsSuffix', () => {
    it('is plain for the overall standings', () => {
        expect(standingsSuffix(null)).toBe('standings');
    });

    it('names the round, because a race with a final has two sets', () => {
        // The overall standings and the championship's disagree on purpose
        // (#17), so a file called "standings" is ambiguous the moment one
        // exists.
        expect(standingsSuffix('Grand Finals')).toBe('standings-grand-finals');
    });

    it('falls back when a round name has nothing to slug', () => {
        expect(standingsSuffix('!!!')).toBe('standings');
    });
});
