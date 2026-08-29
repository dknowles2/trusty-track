import { describe, expect, it } from 'vitest';
import {
    EMPTY_LANE,
    TO_BE_DECIDED,
    buildHeatSheet,
    cellFor,
    roundTitle,
    totalHeats,
    type SheetHeat,
    type SheetRacer,
} from './heatSheet';

const RACERS: SheetRacer[] = [
    { id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 3 },
    { id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 7 },
    { id: 3, firstName: 'Alan', lastName: 'Turing', carNumber: 11 },
];
const BY_ID = new Map(RACERS.map((r) => [r.id, r]));

const heat = (over: Partial<SheetHeat> = {}): SheetHeat => ({
    id: 100,
    heatNumber: 1,
    roundId: 10,
    lanes: [
        { lane: 1, racerId: 1 },
        { lane: 2, racerId: 2 },
    ],
    ...over,
});

describe('cellFor', () => {
    it('names the racer and their car number', () => {
        expect(cellFor({ lane: 1, racerId: 1 }, BY_ID)).toEqual({
            lane: 1,
            carNumber: '3',
            name: 'Ada Lovelace',
        });
    });

    it('says a championship slot is still to be decided', () => {
        // Different from an empty lane on paper in a way it is not in the
        // data: this lane *will* have somebody in it, so the announcer should
        // expect to write a name in rather than skip it.
        expect(cellFor({ lane: 3, placeholderSlot: 2 }, BY_ID).name).toBe(TO_BE_DECIDED);
    });

    it('marks a lane nobody is in', () => {
        expect(cellFor({ lane: 4 }, BY_ID).name).toBe(EMPTY_LANE);
    });

    it('does not crash on a racer the roster no longer has', () => {
        // `ON DELETE SET NULL` makes this rare, but a stale page produces it,
        // and a print page that throws on race morning is the worst outcome.
        expect(cellFor({ lane: 1, racerId: 999 }, BY_ID).name).toBe(EMPTY_LANE);
    });

    it('leaves an unnumbered car blank rather than printing null', () => {
        const byId = new Map([[9, { id: 9, firstName: 'Sam', lastName: 'Okafor' }]]);
        expect(cellFor({ lane: 1, racerId: 9 }, byId)).toEqual({
            lane: 1,
            carNumber: '',
            name: 'Sam Okafor',
        });
    });
});

describe('roundTitle', () => {
    it('uses the name the operator gave it', () => {
        expect(roundTitle({ id: 1, roundNumber: 2, name: 'Grand Finals' })).toBe('Grand Finals');
    });

    it('falls back to the number', () => {
        expect(roundTitle({ id: 1, roundNumber: 1 })).toBe('Round 1');
    });

    it('says which unnamed rounds are championships', () => {
        expect(roundTitle({ id: 1, roundNumber: 2, advancementSource: 'ALL' })).toBe(
            'Championship round 2',
        );
    });
});

describe('buildHeatSheet', () => {
    const rounds = [
        { id: 10, roundNumber: 1 },
        { id: 20, roundNumber: 2, advancementSource: 'ALL' },
    ];

    it('gives every row the same columns, whatever the heat holds', () => {
        // A table whose rows have different widths is unreadable, and the gap
        // carries information: that lane is empty and should not be waited for.
        const sections = buildHeatSheet(
            rounds,
            [heat({ lanes: [{ lane: 1, racerId: 1 }] })],
            RACERS,
            [1, 2, 3, 4],
        );
        expect(sections[0].rows[0].cells.map((c) => c.lane)).toEqual([1, 2, 3, 4]);
        expect(sections[0].rows[0].cells[3].name).toBe(EMPTY_LANE);
    });

    it('uses the track lanes given, so a dead lane is not a column', () => {
        // Lane 3 out of service (#171): the sheet should not have a column
        // nobody can ever race in.
        const sections = buildHeatSheet(rounds, [heat()], RACERS, [1, 2, 4]);
        expect(sections[0].rows[0].cells.map((c) => c.lane)).toEqual([1, 2, 4]);
    });

    it('orders heats within a round by heat number', () => {
        const sections = buildHeatSheet(
            rounds,
            [heat({ id: 2, heatNumber: 2 }), heat({ id: 1, heatNumber: 1 })],
            RACERS,
            [1, 2],
        );
        expect(sections[0].rows.map((r) => r.heatNumber)).toEqual([1, 2]);
    });

    it('orders rounds by round number', () => {
        const sections = buildHeatSheet(
            [
                { id: 20, roundNumber: 2, advancementSource: 'ALL' },
                { id: 10, roundNumber: 1 },
            ],
            [heat({ roundId: 20 }), heat({ id: 101, roundId: 10 })],
            RACERS,
            [1, 2],
        );
        expect(sections.map((s) => s.roundId)).toEqual([10, 20]);
    });

    it('leaves out a round with no heats', () => {
        // A round created and never generated is not part of the running
        // order, and an empty table under a heading reads as a mistake.
        const sections = buildHeatSheet(rounds, [heat({ roundId: 10 })], RACERS, [1, 2]);
        expect(sections).toHaveLength(1);
    });

    it('leaves out a free race heat, which has no round', () => {
        // An exhibition run is not scheduled and does not belong on the
        // running order (#6).
        const sections = buildHeatSheet(
            rounds,
            [heat({ roundId: 10 }), heat({ id: 500, roundId: null })],
            RACERS,
            [1, 2],
        );
        expect(totalHeats(sections)).toBe(1);
    });

    it('counts every heat across every round', () => {
        const sections = buildHeatSheet(
            rounds,
            [
                heat({ id: 1, heatNumber: 1, roundId: 10 }),
                heat({ id: 2, heatNumber: 2, roundId: 10 }),
                heat({ id: 3, heatNumber: 1, roundId: 20 }),
            ],
            RACERS,
            [1, 2],
        );
        expect(totalHeats(sections)).toBe(3);
    });

    it('produces nothing at all for a race with no schedule', () => {
        expect(buildHeatSheet(rounds, [], RACERS, [1, 2])).toEqual([]);
        expect(totalHeats([])).toBe(0);
    });
});
