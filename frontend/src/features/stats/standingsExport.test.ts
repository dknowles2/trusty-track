import { describe, expect, it } from 'vitest';
import {
    scoreHeading,
    scoreValue,
    standingsRows,
    standingsSuffix,
    tieBrokenByValue,
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

    it('names cumulative time and fastest time differently, even though both are time-based (#547)', () => {
        expect(scoreHeading('CUMULATIVE_TIME')).toBe('Total Time (s)');
        expect(scoreHeading('FASTEST_TIME')).toBe('Best Time (s)');
    });

    it('keeps milliseconds on a time', () => {
        expect(scoreValue(3.2016, 'TIMED')).toBe('3.202');
        expect(scoreValue(3.2, 'TIMED')).toBe('3.200');
    });

    it('keeps milliseconds under the two new time-based strategies too', () => {
        expect(scoreValue(3.2016, 'CUMULATIVE_TIME')).toBe('3.202');
        expect(scoreValue(3.2016, 'FASTEST_TIME')).toBe('3.202');
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
            'Tie Broken By',
        ]);
    });

    it('leaves the Tie Broken By cell blank for a row that was never tied', () => {
        const rows = standingsRows([entry({ resolvedBy: null })], 'TIMED');
        expect(rows[1][7]).toBe('');
    });

    it('leaves the Tie Broken By cell blank for an unresolved tie', () => {
        // Same "nothing to say" the standings page itself shows (#540).
        const rows = standingsRows([entry({ resolvedBy: undefined })], 'TIMED');
        expect(rows[1][7]).toBe('');
    });

    it('names how a resolved tie was broken', () => {
        const rows = standingsRows([entry({ resolvedBy: 'BEST_TIME' })], 'TIMED');
        expect(rows[1][7]).toBe('Fastest single heat');
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
            'Tie Broken By',
        ]);
    });

    describe('name display (#552)', () => {
        it('is byte-identical to today under FULL, the default', () => {
            const rows = standingsRows([entry()], 'TIMED', 'Den', 'Car', 'FULL');
            expect(rows[0].slice(2, 4)).toEqual(['First Name', 'Last Name']);
            expect(rows[1].slice(2, 4)).toEqual(['Ada', 'Lovelace']);
        });

        it('collapses to one Name column when abbreviating', () => {
            const rows = standingsRows([entry()], 'TIMED', 'Den', 'Car', 'LAST_INITIAL');
            expect(rows[0]).toEqual([
                'Rank',
                'Car #',
                'Name',
                'Den',
                'Average Time (s)',
                'Heats',
                'Tie Broken By',
            ]);
            expect(rows[1][2]).toBe('Ada L.');
        });
    });
});

describe('tieBrokenByValue', () => {
    it('capitalises the method phrase', () => {
        expect(tieBrokenByValue('COUNTBACK')).toBe('Countback');
        expect(tieBrokenByValue('HEAD_TO_HEAD')).toBe('Head-to-head');
    });

    it('is blank for SHARED, and for a row never tied', () => {
        expect(tieBrokenByValue('SHARED')).toBe('');
        expect(tieBrokenByValue(null)).toBe('');
        expect(tieBrokenByValue(undefined)).toBe('');
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
