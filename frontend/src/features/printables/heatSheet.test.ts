import { describe, expect, it } from 'vitest';
import {
    EMPTY_LANE,
    MASTER_RUNNING_ORDER_TITLE,
    TO_BE_DECIDED,
    buildHeatSheet,
    cellFor,
    roundTitle,
    runOffTitle,
    totalHeats,
    type SheetHeat,
    type SheetRacer,
    type SheetRunOffHeat,
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

    it('abbreviates the name when told to (#552)', () => {
        expect(cellFor({ lane: 1, racerId: 1 }, BY_ID, 'LAST_INITIAL').name).toBe('Ada L.');
    });

    it('defaults to a full name for a caller that has not resolved the setting', () => {
        expect(cellFor({ lane: 1, racerId: 1 }, BY_ID).name).toBe('Ada Lovelace');
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

    // #890 — with the master running order on, `crud.heats_in_running_order`
    // is what the operator's Race tab and the wall displays actually
    // execute: a general round's heats interleave by `heatNumber` alone
    // rather than one round's block, then the next's. The printed sheet
    // used to ignore the flag entirely and sort round-then-heat regardless,
    // so the paper fallback and the screen disagreed about what was next.
    describe('master running order (#890)', () => {
        // Two general rounds interleaved: heat numbers 1 and 3 belong to
        // round 10, heats 2 and 4 to round 20 — exactly the shape
        // `applyMasterRunningOrder` produces (`runningOrder.ts`'s own
        // fixtures use the same interleave).
        const interleavedRounds = [
            { id: 10, roundNumber: 1 },
            { id: 20, roundNumber: 2 },
        ];
        const interleavedHeats = [
            heat({ id: 1, heatNumber: 1, roundId: 10 }),
            heat({ id: 2, heatNumber: 2, roundId: 20 }),
            heat({ id: 3, heatNumber: 3, roundId: 10 }),
            heat({ id: 4, heatNumber: 4, roundId: 20 }),
        ];

        it('adds no flat section when the flag is off, the default for every existing race', () => {
            const sections = buildHeatSheet(interleavedRounds, interleavedHeats, RACERS, [1, 2]);
            expect(sections.map((s) => s.title)).toEqual(['Round 1', 'Round 2']);
        });

        it('leads with one flat section in true execution order when the flag is on', () => {
            const sections = buildHeatSheet(
                interleavedRounds,
                interleavedHeats,
                RACERS,
                [1, 2],
                'FULL',
                true,
            );

            expect(sections[0].title).toBe(MASTER_RUNNING_ORDER_TITLE);
            expect(sections[0].rows.map((r) => r.heatId)).toEqual([1, 2, 3, 4]);
            // The per-round tables stay underneath, unchanged, as the
            // schedule's own detail view.
            expect(sections.slice(1).map((s) => s.title)).toEqual(['Round 1', 'Round 2']);
        });

        it('keeps a championship round out of the flat section and after every general round', () => {
            const roundsWithChampionship = [
                ...interleavedRounds,
                { id: 30, roundNumber: 3, advancementSource: 'ALL' },
            ];
            const heatsWithChampionship = [
                ...interleavedHeats,
                heat({ id: 5, heatNumber: 1, roundId: 30 }),
            ];

            const sections = buildHeatSheet(
                roundsWithChampionship,
                heatsWithChampionship,
                RACERS,
                [1, 2],
                'FULL',
                true,
            );

            expect(sections[0].title).toBe(MASTER_RUNNING_ORDER_TITLE);
            // Only the two general rounds' heats are in the flat table.
            expect(sections[0].rows.map((r) => r.heatId)).toEqual([1, 2, 3, 4]);
            // The championship round still gets its own per-round table,
            // last, exactly as it always did.
            expect(sections.map((s) => s.title)).toEqual([
                MASTER_RUNNING_ORDER_TITLE,
                'Round 1',
                'Round 2',
                'Championship round 3',
            ]);
        });

        it('produces no flat section when nothing general is scheduled yet', () => {
            const sections = buildHeatSheet([], [], RACERS, [1, 2], 'FULL', true);
            expect(sections).toEqual([]);
        });
    });

    // #890 — a run-off heat (#550) is a `Heat` with no `roundId` of its own,
    // so it never joined a round's own section. It has no paper fallback at
    // all before this, though it is armed and raced on the track exactly
    // like any other heat.
    describe('run-off heats (#890)', () => {
        const runOff = (over: Partial<SheetRunOffHeat> = {}): SheetRunOffHeat => ({
            id: 900,
            settlesRoundId: 10,
            placement: 1,
            lanes: [
                { lane: 1, racerId: 1 },
                { lane: 2, racerId: 3 },
            ],
            ...over,
        });

        it('is left out with no run-off heats supplied, same as before', () => {
            const sections = buildHeatSheet(rounds, [heat({ roundId: 10 })], RACERS, [1, 2]);
            expect(sections.map((s) => s.title)).toEqual(['Round 1']);
        });

        it('sorts a run-off immediately after the round it settles', () => {
            const sections = buildHeatSheet(
                rounds,
                [heat({ roundId: 10 })],
                RACERS,
                [1, 2],
                'FULL',
                false,
                [runOff({ settlesRoundId: 10, placement: 1 })],
            );

            expect(sections.map((s) => s.title)).toEqual(['Round 1', runOffTitle(1)]);
            expect(sections[1].rows[0].cells.map((c) => c.name)).toEqual(['Ada Lovelace', 'Alan Turing']);
        });

        it('sorts a run-off for the overall standings after every round', () => {
            const sections = buildHeatSheet(
                rounds,
                [heat({ roundId: 10 }), heat({ id: 2, roundId: 20 })],
                RACERS,
                [1, 2],
                'FULL',
                false,
                [runOff({ settlesRoundId: null, placement: 3 })],
            );

            expect(sections.map((s) => s.title)).toEqual([
                'Round 1',
                'Championship round 2',
                runOffTitle(3),
            ]);
        });

        it('names the placement it is racing off to decide', () => {
            expect(runOffTitle(2)).toBe('Run-off for 2nd place');
        });

        it('falls back to a plain label when the tie it settled has since moved', () => {
            // `run_off_contested_rank` returns null once a correction moves
            // or dissolves the tie (#550, rule 4) — the heat still ran and
            // still belongs on paper, just with nothing left to announce.
            expect(runOffTitle(null)).toBe('Run-off');
        });

        it('counts a run-off heat toward the total', () => {
            const sections = buildHeatSheet(
                rounds,
                [heat({ roundId: 10 })],
                RACERS,
                [1, 2],
                'FULL',
                false,
                [runOff()],
            );
            expect(totalHeats(sections)).toBe(2);
        });
    });
});
