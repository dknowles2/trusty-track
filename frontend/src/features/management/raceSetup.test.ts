import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINOLOGY } from '../../context/TerminologyContext';
import { CATEGORY_PRESETS } from '../../context/categoryPresets';
import { DEFAULT_ANSWERS, wordsFor } from '../../context/organizationKinds';
import {
    blankGroup,
    copiedGroups,
    copyableAwards,
    firstGroupProblem,
    prefillFromRace,
    raceOverrideFor,
    roundPlanSummary,
    scaffoldGroups,
    stepsFor,
    toAwardCopyInput,
    toRacingGroupInput,
    toWizardConfigurationInput,
    type RacingGroupDraft,
    type SourceAward,
    type SourceRace,
    type SourceRoundPlan,
} from './raceSetup';

const words = { groupLower: 'den', groupsLower: 'dens' };

describe('raceOverrideFor', () => {
    it('stores nothing when the words are the install default — the race inherits', () => {
        const override = raceOverrideFor(wordsFor(DEFAULT_ANSWERS), DEFAULT_TERMINOLOGY);
        expect(Object.values(override).every((v) => v === null)).toBe(true);
    });

    it('stores all seven when any differs', () => {
        const override = raceOverrideFor(
            wordsFor({ ...DEFAULT_ANSWERS, eventKind: 'raingutter' }),
            DEFAULT_TERMINOLOGY,
        );
        expect(override).toEqual({
            racing_group_singular: 'Den',
            racing_group_plural: 'Dens',
            organization_singular: 'Pack',
            organization_plural: 'Packs',
            vehicle_singular: 'Boat',
            vehicle_plural: 'Boats',
            vehicle_artwork_key: 'boat',
        });
    });

    it('compares against the install default it is given, not the built-in words', () => {
        // An install whose default is already a Space Derby: choosing Space
        // Derby again is "no change", and choosing Pinewood is the override.
        const rocketInstall = {
            ...DEFAULT_TERMINOLOGY,
            vehicleSingular: 'Rocket',
            vehiclePlural: 'Rockets',
            vehicleArtworkKey: 'rocket',
        };
        expect(raceOverrideFor(wordsFor({ ...DEFAULT_ANSWERS, eventKind: 'space' }), rocketInstall).vehicle_singular).toBeNull();
        expect(raceOverrideFor(wordsFor(DEFAULT_ANSWERS), rocketInstall).vehicle_singular).toBe('Car');
    });
});

describe('scaffoldGroups', () => {
    it('gives Cub Scouts the six ranks, in order, each with the next hundred block', () => {
        const groups = scaffoldGroups(DEFAULT_ANSWERS);
        expect(groups.map((g) => g.name)).toEqual(['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light']);
        expect(groups.map((g) => g.division)).toEqual(['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light']);
        expect(groups.map((g) => g.car_number_range_start)).toEqual([100, 200, 300, 400, 500, 600]);
        expect(groups[5].car_number_range_end).toBe(699);
    });

    it('a district derby scaffolds the same six — raced by rank', () => {
        expect(scaffoldGroups({ ...DEFAULT_ANSWERS, scale: 'tournament' }).map((g) => g.name))
            .toEqual(scaffoldGroups(DEFAULT_ANSWERS).map((g) => g.name));
    });

    it('every Cub Scout preset is a category the Category picker already offers', () => {
        for (const group of scaffoldGroups(DEFAULT_ANSWERS)) {
            expect(CATEGORY_PRESETS).toContain(group.division);
        }
    });

    it('Awana gets its five age groups; a school and "something else" start blank', () => {
        expect(scaffoldGroups({ ...DEFAULT_ANSWERS, organizationKind: 'awana' }).map((g) => g.name))
            .toEqual(['Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
        expect(scaffoldGroups({ ...DEFAULT_ANSWERS, organizationKind: 'school' })).toEqual([]);
        expect(scaffoldGroups({ ...DEFAULT_ANSWERS, organizationKind: 'other' })).toEqual([]);
    });
});

describe('blankGroup', () => {
    it('takes the block after the last one in use', () => {
        const groups = scaffoldGroups(DEFAULT_ANSWERS);
        expect(blankGroup(groups)).toMatchObject({ name: '', car_number_range_start: 700, car_number_range_end: 799 });
        expect(blankGroup([])).toMatchObject({ car_number_range_start: 100, car_number_range_end: 199 });
    });
});

const lastYear: SourceRace = {
    id: 4,
    location: 'Church Gym',
    scoringStrategy: 'POINTS',
    tiebreaker: 'COUNTBACK',
    dropWorstRuns: 1,
    carNumberingStrategy: 'PER_GROUP',
    globalStartNumber: 1,
    championshipTrophies: 4,
    weightLimitOz: null,
    racingGroupSingular: null,
    racingGroupPlural: null,
    organizationSingular: null,
    organizationPlural: null,
    vehicleSingular: 'Rocket',
    vehiclePlural: 'Rockets',
    vehicleArtworkKey: 'rocket',
    racingGroups: [
        { id: 10, name: 'Wolves', color: '#AAB7B8', division: 'Wolf', carNumberRangeStart: 100, carNumberRangeEnd: 199 },
        { id: 11, name: 'Bears', color: '#85C1E9', division: null, carNumberRangeStart: null, carNumberRangeEnd: null },
    ],
    awards: [],
};

describe('copiedGroups', () => {
    it('keeps names, colours, categories and ranges, and drops nothing else there is', () => {
        expect(copiedGroups(lastYear.racingGroups)).toEqual([
            { name: 'Wolves', color: '#AAB7B8', division: 'Wolf', car_number_range_start: 100, car_number_range_end: 199, copied_from_id: 10 },
            { name: 'Bears', color: '#85C1E9', division: '', car_number_range_start: undefined, car_number_range_end: undefined, copied_from_id: 11 },
        ]);
    });
});

describe('prefillFromRace', () => {
    it('copies the settings and the venue, and copies the words raw', () => {
        const prefill = prefillFromRace(lastYear);
        expect(prefill).toMatchObject({
            location: 'Church Gym',
            scoring_strategy: 'POINTS',
            tiebreaker: 'COUNTBACK',
            drop_worst_runs: 1,
            car_numbering_strategy: 'PER_GROUP',
            championship_trophies: 4,
            vehicle_singular: 'Rocket',
            vehicle_artwork_key: 'rocket',
        });
        // Inherited last year stays inherited, rather than being frozen to
        // whatever it resolved to.
        expect(prefill.racing_group_singular).toBeNull();
        // No check last year is no check this year — not the form's default.
        expect(prefill.weight_limit_oz).toBeNull();
    });

    it('does not copy the name or the date — those are what make it a new race', () => {
        const prefill = prefillFromRace(lastYear);
        expect(prefill).not.toHaveProperty('name');
        expect(prefill).not.toHaveProperty('date_time');
    });
});

describe('stepsFor', () => {
    it('asks scratch-or-copy only once there is something to copy', () => {
        expect(stepsFor('scratch', false)).toEqual(['kind', 'groups', 'details']);
        expect(stepsFor('scratch', true)).toEqual(['start', 'kind', 'groups', 'details']);
    });

    it('copying skips the questions — the previous race is the answer', () => {
        expect(stepsFor('copy', true)).toEqual(['start', 'groups', 'details']);
    });
});

describe('firstGroupProblem', () => {
    const ok = scaffoldGroups(DEFAULT_ANSWERS);

    it('passes a sensible list, including an empty one', () => {
        expect(firstGroupProblem(ok, words)).toBeNull();
        expect(firstGroupProblem([], words)).toBeNull();
    });

    it('refuses a blank name, and says which row', () => {
        const groups = [ok[0], { ...ok[1], name: '  ' }];
        expect(firstGroupProblem(groups, words)).toEqual({ index: 1, message: 'Every den needs a name.' });
    });

    it('refuses two groups with the same name, whatever the case', () => {
        const groups = [ok[0], { ...ok[1], name: 'lion' }];
        expect(firstGroupProblem(groups, words)?.index).toBe(1);
        expect(firstGroupProblem(groups, words)?.message).toContain('both called');
    });

    it('refuses a backwards range, and allows a missing one', () => {
        expect(firstGroupProblem([{ ...ok[0], car_number_range_start: 200, car_number_range_end: 100 }], words)?.message)
            .toContain('end number');
        expect(firstGroupProblem([{ ...ok[0], car_number_range_start: undefined, car_number_range_end: undefined }], words))
            .toBeNull();
    });
});

describe('toRacingGroupInput', () => {
    it('trims, and sends blanks as null so the server stores no category', () => {
        expect(toRacingGroupInput({ name: ' Lion ', color: '#F4D03F', division: '  ' })).toEqual({
            name: 'Lion',
            color: '#F4D03F',
            division: null,
            carNumberRangeStart: null,
            carNumberRangeEnd: null,
            copiedFromId: null,
        });
    });

    it('carries a copied group’s old id along, for the award remap on the way in', () => {
        expect(toRacingGroupInput({ name: 'Wolves', color: '#AAB7B8', division: '', copied_from_id: 10 }))
            .toMatchObject({ copiedFromId: 10 });
    });
});

/** An award as `GET_RACE_SETUP_SOURCE` would return it, filled out enough
 * for `copyableAwards` to reason about. */
function sourceAward(overrides: Partial<SourceAward>): SourceAward {
    return {
        id: 1,
        name: 'Fastest Overall',
        kind: 'SPEED',
        source: 'ALL',
        place: 1,
        fromBottom: false,
        racingGroupId: null,
        artworkKey: 'trophy',
        sortOrder: 0,
        votable: false,
        ...overrides,
    };
}

/** A round plan as `GET_RACE_SETUP_SOURCE` would return it — one PPC
 * qualifying round and one `ALL` top-3 final whose id is 9, the same id
 * `sourceAward`'s `ROUND:9` awards below name. */
function sourceRoundPlan(overrides: Partial<SourceRoundPlan> = {}): SourceRoundPlan {
    return {
        generalRound: { type: 'ALL', schedulingStrategy: 'PPC', runsPerLane: 2 },
        championshipRounds: [
            {
                name: 'Finals',
                source: 'ALL',
                numTopRacers: 3,
                runsPerLane: 1,
                advancementFromBottom: false,
                sourceRoundId: 9,
            },
        ],
        ...overrides,
    };
}

describe('copyableAwards', () => {
    const copiedWolves: RacingGroupDraft = { name: 'Wolves', color: '#AAB7B8', division: 'Wolf', copied_from_id: 10 };

    it('copies an unscoped SPEED award and a SPECIAL award as plain definitions', () => {
        const bestPaint = sourceAward({
            id: 2,
            name: 'Best Paint',
            kind: 'SPECIAL',
            source: null,
            place: null,
            artworkKey: null,
            votable: true,
        });
        const plan = copyableAwards([sourceAward({}), bestPaint], [], null, true);
        expect(plan.excluded).toEqual([]);
        expect(plan.toCopy).toEqual([
            {
                name: 'Fastest Overall',
                kind: 'SPEED',
                source: 'ALL',
                place: 1,
                from_bottom: false,
                racing_group_id: null,
                artwork_key: 'trophy',
                sort_order: 0,
                votable: false,
                copied_from_round_id: null,
            },
            {
                name: 'Best Paint',
                kind: 'SPECIAL',
                source: null,
                place: null,
                from_bottom: false,
                racing_group_id: null,
                artwork_key: null,
                sort_order: 0,
                votable: true,
                copied_from_round_id: null,
            },
        ]);
    });

    it('never carries a SPECIAL award’s recipient — there is no field for one', () => {
        const plan = copyableAwards(
            [sourceAward({ id: 2, name: 'Best Paint', kind: 'SPECIAL', source: null, place: null })],
            [],
            null,
            true,
        );
        expect(plan.toCopy[0]).not.toHaveProperty('racer_id');
        expect(plan.toCopy[0]).not.toHaveProperty('racerId');
    });

    it('follows a racing-group-scoped award to the new race’s equivalent group', () => {
        const fastestWolf = sourceAward({ id: 3, name: 'Fastest Wolf', racingGroupId: 10 });
        const plan = copyableAwards([fastestWolf], [copiedWolves], null, true);
        expect(plan.excluded).toEqual([]);
        expect(plan.toCopy[0].racing_group_id).toBe(10);
    });

    it('excludes an award scoped to a group the operator removed', () => {
        const fastestWolf = sourceAward({ id: 3, name: 'Fastest Wolf', racingGroupId: 10 });
        const plan = copyableAwards([fastestWolf], [], null, true);
        expect(plan.toCopy).toEqual([]);
        expect(plan.excluded).toEqual([{ award: fastestWolf, reason: expect.stringContaining('not carried over') }]);
    });

    it('re-points a round-scoped award at the new race’s own round when the plan reproduces it (#1088)', () => {
        const finalsWinner = sourceAward({ id: 4, name: 'Pack Champion', source: 'ROUND:9' });
        const plan = copyableAwards([finalsWinner], [], sourceRoundPlan(), true);
        expect(plan.excluded).toEqual([]);
        expect(plan.toCopy[0]).toMatchObject({ source: 'ROUND:9', copied_from_round_id: 9 });
    });

    it('excludes a round-scoped award naming a round the plan does not reproduce', () => {
        // id 42 is not any championship round's `sourceRoundId` in the plan
        // — a general round, a run-off, or one no longer part of it.
        const stale = sourceAward({ id: 4, name: 'Stale Champion', source: 'ROUND:42' });
        const plan = copyableAwards([stale], [], sourceRoundPlan(), true);
        expect(plan.toCopy).toEqual([]);
        expect(plan.excluded).toEqual([
            { award: stale, reason: expect.stringContaining('does not reproduce') },
        ]);
    });

    it('excludes every round-scoped award when the rounds are not being copied', () => {
        const finalsWinner = sourceAward({ id: 4, name: 'Pack Champion', source: 'ROUND:9' });
        const plan = copyableAwards([finalsWinner], [], sourceRoundPlan(), false);
        expect(plan.toCopy).toEqual([]);
        expect(plan.excluded).toEqual([
            { award: finalsWinner, reason: expect.stringContaining('not being copied') },
        ]);
    });

    it('excludes a round-scoped award when there is no round plan to copy at all', () => {
        const finalsWinner = sourceAward({ id: 4, name: 'Pack Champion', source: 'ROUND:9' });
        const plan = copyableAwards([finalsWinner], [], null, true);
        expect(plan.toCopy).toEqual([]);
        expect(plan.excluded[0].reason).toMatch(/not being copied|does not reproduce/);
    });
});

describe('toAwardCopyInput', () => {
    it('maps to the camelCase mutation input, unscoped and un-derived fields intact', () => {
        expect(
            toAwardCopyInput({
                name: 'Fastest Overall',
                kind: 'SPEED',
                source: 'ALL',
                place: 1,
                from_bottom: false,
                racing_group_id: null,
                artwork_key: 'trophy',
                sort_order: 0,
                votable: false,
                copied_from_round_id: null,
            }),
        ).toEqual({
            name: 'Fastest Overall',
            kind: 'SPEED',
            source: 'ALL',
            place: 1,
            fromBottom: false,
            racingGroupId: null,
            artworkKey: 'trophy',
            sortOrder: 0,
            votable: false,
            copiedFromRoundId: null,
        });
    });

    it('carries a re-pointed round id along', () => {
        expect(
            toAwardCopyInput({
                name: 'Pack Champion',
                kind: 'SPEED',
                source: 'ROUND:9',
                place: 1,
                from_bottom: false,
                racing_group_id: null,
                artwork_key: 'trophy',
                sort_order: 0,
                votable: false,
                copied_from_round_id: 9,
            }),
        ).toMatchObject({ copiedFromRoundId: 9 });
    });
});

describe('toWizardConfigurationInput', () => {
    it('maps a copied round plan to the camelCase createRace input, carrying sourceRoundId along', () => {
        expect(toWizardConfigurationInput(sourceRoundPlan())).toEqual({
            generalRound: {
                type: 'ALL',
                schedulingStrategy: 'PPC',
                runsPerLane: 2,
                eliminationLosses: null,
                balancedPhases: null,
            },
            championshipRounds: [
                {
                    name: 'Finals',
                    source: 'ALL',
                    numTopRacers: 3,
                    runsPerLane: 1,
                    advancementFromBottom: false,
                    sourceRoundId: 9,
                },
            ],
        });
    });
});

describe('roundPlanSummary', () => {
    it('reads the shape the issue asked for', () => {
        expect(roundPlanSummary(sourceRoundPlan(), 'Pack 12 Derby 2025')).toBe(
            'Rounds: 1 qualifying (PPC, 2 runs per lane) → Finals (top 3) — from *Pack 12 Derby 2025*',
        );
    });

    it('defaults the group word to "den" for an EACH_GROUP general round', () => {
        const plan = sourceRoundPlan({
            generalRound: { type: 'EACH_GROUP', schedulingStrategy: 'PPC', runsPerLane: 1 },
        });
        expect(roundPlanSummary(plan, 'Last Year')).toContain('Qualifying by den');
    });

    it('says "by rank" for a district derby copying an EACH_GROUP race, not the literal "group" (terminology)', () => {
        const plan = sourceRoundPlan({
            generalRound: { type: 'EACH_GROUP', schedulingStrategy: 'PPC', runsPerLane: 1 },
        });
        const summary = roundPlanSummary(plan, 'Last Year', 'rank');
        expect(summary).toContain('Qualifying by rank');
        expect(summary).not.toContain('group');
    });

    it('names an Elimination or Balanced general round with no championship round', () => {
        const plan = sourceRoundPlan({
            generalRound: { type: 'ALL', schedulingStrategy: 'ELIMINATION', runsPerLane: 1 },
            championshipRounds: [],
        });
        expect(roundPlanSummary(plan, 'Last Year')).toBe(
            'Rounds: 1 qualifying (Elimination, 1 run per lane) — from *Last Year*',
        );
    });
});
