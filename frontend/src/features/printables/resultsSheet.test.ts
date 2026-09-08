import { describe, expect, it } from 'vitest';
import {
    awardLines,
    championshipSections,
    hasResults,
    NO_DEN,
    OVERALL,
    resultsSections,
    UNDECIDED,
    type ResultsAward,
    type ResultsEntry,
} from './resultsSheet';

const entry = (over: Partial<ResultsEntry> & { racerId: number }): ResultsEntry => ({
    rank: 1,
    firstName: 'Ada',
    lastName: 'Ant',
    carNumber: 1,
    racingGroupName: 'Wolves',
    score: 3.5,
    heatsCompleted: 4,
    ...over,
});

const titles = (sections: ReturnType<typeof resultsSections>) => sections.map((s) => s.title);

describe('resultsSections', () => {
    it('produces nothing before anybody has raced', () => {
        expect(resultsSections([], 'TIMED')).toEqual([]);
    });

    it('leads with the overall table', () => {
        const [first] = resultsSections([entry({ racerId: 1 })], 'TIMED');

        expect(first.title).toBe(OVERALL);
    });

    it('adds a table per racingGroup', () => {
        const sections = resultsSections(
            [
                entry({ racerId: 1, racingGroupName: 'Wolves' }),
                entry({ racerId: 2, racingGroupName: 'Bears' }),
            ],
            'TIMED',
        );

        expect(titles(sections)).toEqual([OVERALL, 'Wolves', 'Bears']);
    });

    it('orders the racingGroups by their fastest racer, not alphabetically', () => {
        // The sheet is about results; alphabetical would be arbitrary here.
        const sections = resultsSections(
            [
                entry({ racerId: 1, racingGroupName: 'Wolves', score: 3.1 }),
                entry({ racerId: 2, racingGroupName: 'Bears', score: 3.2 }),
            ],
            'TIMED',
        );

        expect(titles(sections).slice(1)).toEqual(['Wolves', 'Bears']);
    });

    it('does not repeat the pack as a racingGroup when there is only one', () => {
        const sections = resultsSections(
            [entry({ racerId: 1, racingGroupName: 'Wolves' }), entry({ racerId: 2, racingGroupName: 'Wolves' })],
            'TIMED',
        );

        expect(titles(sections)).toEqual([OVERALL]);
    });

    it('numbers each section from one rather than carrying the pack rank', () => {
        // A racingGroup table headed 4, 9, 17 is a table of pack ranks; the person
        // reading it wants to know who won the racingGroup.
        const sections = resultsSections(
            [
                entry({ racerId: 1, rank: 1, racingGroupName: 'Wolves' }),
                entry({ racerId: 2, rank: 2, racingGroupName: 'Bears' }),
                entry({ racerId: 3, rank: 3, racingGroupName: 'Wolves' }),
            ],
            'TIMED',
        );
        const wolves = sections.find((s) => s.title === 'Wolves')!;

        expect(wolves.rows.map((r) => r.place)).toEqual([1, 2]);
    });

    // #883 — the printed sheet used to number every row `index + 1`, so two
    // racers tied for first (both `rank: 1`, the shared competition rank
    // `standings_ranks` stamps, #226) printed as 1 / 2. That is exactly the
    // "resolved by registration order and no screen ever said so" failure
    // #226 closed for the screen, back on paper.
    it('keeps a shared rank on the overall table rather than renumbering ties away', () => {
        const [overall] = resultsSections(
            [
                entry({ racerId: 1, rank: 1, score: 3.0 }),
                entry({ racerId: 2, rank: 1, score: 3.0 }),
                entry({ racerId: 3, rank: 3, score: 3.5 }),
            ],
            'TIMED',
        );

        expect(overall.rows.map((r) => r.place)).toEqual([1, 1, 3]);
    });

    it('also collapses a tie within a racingGroup table, re-based to that group', () => {
        // Two Wolves tied for the pack's overall 1st/2nd should still read
        // as tied — 1, 1 — once the table is re-based to the den, rather
        // than the tie being silently resolved by table position.
        const sections = resultsSections(
            [
                entry({ racerId: 1, rank: 1, racingGroupName: 'Wolves', score: 3.0 }),
                entry({ racerId: 2, rank: 1, racingGroupName: 'Wolves', score: 3.0 }),
                entry({ racerId: 3, rank: 3, racingGroupName: 'Bears', score: 3.5 }),
            ],
            'TIMED',
        );
        const wolves = sections.find((s) => s.title === 'Wolves')!;

        expect(wolves.rows.map((r) => r.place)).toEqual([1, 1]);
    });

    it('keeps a racer in no racingGroup out of the per-racing-group tables', () => {
        // "No racingGroup" is not a racingGroup anybody wins, and they are in the table above.
        const sections = resultsSections(
            [
                entry({ racerId: 1, racingGroupName: 'Wolves' }),
                entry({ racerId: 2, racingGroupName: null }),
                entry({ racerId: 3, racingGroupName: 'Bears' }),
            ],
            'TIMED',
        );

        expect(titles(sections)).toEqual([OVERALL, 'Wolves', 'Bears']);
    });

    it('still lists a racer in no racingGroup in the overall table', () => {
        const [overall] = resultsSections([entry({ racerId: 2, racingGroupName: null })], 'TIMED');

        expect(overall.rows).toHaveLength(1);
        expect(overall.rows[0].racingGroupName).toBe(NO_DEN);
    });

    it('keeps the milliseconds on a timed score', () => {
        const [overall] = resultsSections([entry({ racerId: 1, score: 3.5 })], 'TIMED');

        expect(overall.rows[0].score).toBe('3.500');
    });

    it('prints points as whole numbers', () => {
        const [overall] = resultsSections([entry({ racerId: 1, score: 7 })], 'POINTS');

        expect(overall.rows[0].score).toBe('7');
    });

    it('leaves the car number blank rather than printing null', () => {
        const [overall] = resultsSections([entry({ racerId: 1, carNumber: null })], 'TIMED');

        expect(overall.rows[0].carNumber).toBe('');
    });

    it('does not mutate what it was given', () => {
        const standings = [entry({ racerId: 1 }), entry({ racerId: 2 })];

        resultsSections(standings, 'TIMED');

        expect(standings.map((s) => s.racerId)).toEqual([1, 2]);
    });

    it('abbreviates a row name when told to (#552)', () => {
        const [overall] = resultsSections([entry({ racerId: 1 })], 'TIMED', NO_DEN, 'FIRST_ONLY');

        expect(overall.rows[0].name).toBe('Ada');
    });
});

const award = (over: Partial<ResultsAward> & { id: number }): ResultsAward => ({
    name: 'Fastest Car',
    kind: 'SPEED',
    sortOrder: 0,
    recipient: null,
    ...over,
});

describe('awardLines', () => {
    it('names the winner with their car number', () => {
        const [line] = awardLines([
            award({ id: 1, recipient: { firstName: 'Ada', lastName: 'Ant', carNumber: 42 } }),
        ]);

        expect(line.winner).toBe('Ada Ant (#42)');
    });

    it('survives a winner with no car number', () => {
        const [line] = awardLines([
            award({ id: 1, recipient: { firstName: 'Ada', lastName: 'Ant', carNumber: null } }),
        ]);

        expect(line.winner).toBe('Ada Ant');
    });

    it('prints an undecided award rather than skipping it', () => {
        // On paper a missing line reads as an award that does not exist, where
        // "Not awarded" reads as one somebody still has to fill in.
        const [line] = awardLines([award({ id: 1, recipient: null })]);

        expect(line.winner).toBe(UNDECIDED);
    });

    it('follows the ceremony order', () => {
        const lines = awardLines([
            award({ id: 1, name: 'Second', sortOrder: 2 }),
            award({ id: 2, name: 'First', sortOrder: 1 }),
        ]);

        expect(lines.map((l) => l.name)).toEqual(['First', 'Second']);
    });

    it('breaks a tie on id, so the order does not depend on the API', () => {
        const lines = awardLines([
            award({ id: 9, name: 'Later', sortOrder: 1 }),
            award({ id: 2, name: 'Earlier', sortOrder: 1 }),
        ]);

        expect(lines.map((l) => l.name)).toEqual(['Earlier', 'Later']);
    });

    it('does not mutate what it was given', () => {
        const awards = [award({ id: 1, sortOrder: 2 }), award({ id: 2, sortOrder: 1 })];

        awardLines(awards);

        expect(awards.map((a) => a.id)).toEqual([1, 2]);
    });

    it('abbreviates the winner when told to (#552)', () => {
        const [line] = awardLines(
            [award({ id: 1, recipient: { firstName: 'Ada', lastName: 'Ant', carNumber: 42 } })],
            'LAST_INITIAL',
        );

        expect(line.winner).toBe('Ada A. (#42)');
    });
});

// #869 — the printed results sheet named seven per-den tables and an
// "Overall standings" table (prelim only, #17), but never the Grand Finals
// itself: the round that actually decides who won. `championshipSections`
// is what supplies that missing table.
describe('championshipSections', () => {
    const round = (over: Partial<Parameters<typeof championshipSections>[0][number]['round']> = {}) => ({
        id: 40,
        roundNumber: 3,
        name: null,
        advancementSource: 'ALL',
        ...over,
    });

    it('prints nothing for a championship round nobody has raced yet', () => {
        // A round exists as soon as the wizard creates it, placeholders and
        // all — printing it before anybody has run a heat would put "0.000"
        // and empty names on the noticeboard.
        const sections = championshipSections(
            [{ round: round(), entries: [entry({ racerId: 1, heatsCompleted: 0 })] }],
            'TIMED',
        );

        expect(sections).toEqual([]);
    });

    it('prints a table for a championship round that has been raced', () => {
        const sections = championshipSections(
            [{ round: round({ name: 'Grand Finals' }), entries: [entry({ racerId: 1, heatsCompleted: 1 })] }],
            'TIMED',
        );

        expect(sections.map((s) => s.title)).toEqual(['Grand Finals']);
    });

    it('falls back to the same round-title rule the heat sheet uses', () => {
        const sections = championshipSections(
            [{ round: round({ name: null, roundNumber: 2 }), entries: [entry({ racerId: 1, heatsCompleted: 1 })] }],
            'TIMED',
        );

        expect(sections[0].title).toBe('Championship round 2');
    });

    it('prints the round-scoped rank exactly, ties included, with no re-basing', () => {
        // A round-scoped `leaderboard(roundId:)` already stamps a
        // competition rank scoped to *this* round (#226), so unlike a
        // racingGroup table (which narrows the pack-wide standings) there
        // is nothing here to re-base.
        const sections = championshipSections(
            [
                {
                    round: round(),
                    entries: [
                        entry({ racerId: 1, rank: 1, heatsCompleted: 1 }),
                        entry({ racerId: 2, rank: 1, heatsCompleted: 1 }),
                        entry({ racerId: 3, rank: 3, heatsCompleted: 1 }),
                    ],
                },
            ],
            'TIMED',
        );

        expect(sections[0].rows.map((r) => r.place)).toEqual([1, 1, 3]);
    });

    it('orders chained championship rounds by round number', () => {
        const sections = championshipSections(
            [
                { round: round({ id: 50, roundNumber: 4, name: 'Grand Finals' }), entries: [entry({ racerId: 1, heatsCompleted: 1 })] },
                { round: round({ id: 40, roundNumber: 3, name: 'Semifinal' }), entries: [entry({ racerId: 2, heatsCompleted: 1 })] },
            ],
            'TIMED',
        );

        expect(sections.map((s) => s.title)).toEqual(['Semifinal', 'Grand Finals']);
    });
});

describe('hasResults', () => {
    it('is false on a race that has neither', () => {
        expect(hasResults([], [])).toBe(false);
    });

    it('is true for a race with awards but no heats run yet', () => {
        // Judged awards are decided without racing, and a pack that hands out
        // only those still has a sheet worth printing.
        expect(hasResults([], awardLines([award({ id: 1 })]))).toBe(true);
    });
});
