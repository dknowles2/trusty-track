/**
 * The race setup wizard's rules (#662) — pure, no React, the same split
 * `raceFlow.ts` makes between what is decided and what is rendered.
 *
 * Most of what the issue asked for already existed under other names. "Race
 * type" (Pinewood Derby, Space Derby, Raingutter Regatta) is the vehicle
 * word and its picture (#551); "organization type" is the organization and
 * racing-group words (#496 stage 3); "one install serving several kinds of
 * event" is the per-race terminology override those already have; and the
 * ready-made den names are `categoryPresets.ts`. What this file adds is the
 * *questions* — a handful of answers a volunteer can give in a sentence,
 * each turned into the seven words and a scaffolded list of groups — and
 * the rule for copying a previous race's structure into a new one.
 *
 * Nothing here is a new vocabulary the backend has to learn. An answer
 * resolves to the same seven nullable columns `updateRace` has accepted
 * since #496, plus ordinary `RacingGroupInput` rows; the wizard writes them
 * through `createRace` in one mutation, and the edit form's **Words and
 * names** section shows exactly what the wizard chose, changeable later.
 *
 * The option labels below name the built-in words on purpose ("Packs and
 * dens") — the same reason `SystemSettings.tsx`'s terminology labels are
 * allowlisted by `terminologyGuard.test.ts`: an option that *chooses* a
 * vocabulary has to say which one it chooses. They live here, in data,
 * rather than in the wizard's JSX, because they are the rule about what an
 * answer means, not display copy the answer controls.
 */

import { DEFAULT_TERMINOLOGY, type Terminology } from '../../context/TerminologyContext';
import { CATEGORY_PRESETS } from './categoryPresets';
import { suggestedRange } from './numberRanges';
import { COMMON_COLORS } from '../../utils/colors';
import type { RaceFormData } from './components/RaceForm';

/* ------------------------------------------------------------------ */
/* What is being raced                                                 */
/* ------------------------------------------------------------------ */

export type EventKindKey = 'pinewood' | 'space' | 'raingutter';

export interface EventKind {
    key: EventKindKey;
    label: string;
    /** One line under the label: what the vehicle is, and what the app will call it. */
    description: string;
    vehicleSingular: string;
    vehiclePlural: string;
    /** One of `domain.terminology.VEHICLE_ARTWORK_KEYS`. */
    vehicleArtworkKey: string;
}

/** In the order a pack meets them — the one everybody runs first. */
export const EVENT_KINDS: readonly EventKind[] = [
    {
        key: 'pinewood',
        label: 'Pinewood Derby',
        description: 'Gravity cars on a sloped track. Each entry is a "Car".',
        vehicleSingular: 'Car',
        vehiclePlural: 'Cars',
        vehicleArtworkKey: 'car',
    },
    {
        key: 'space',
        label: 'Space Derby',
        description: 'Propeller rockets along a wire. Each entry is a "Rocket".',
        vehicleSingular: 'Rocket',
        vehiclePlural: 'Rockets',
        vehicleArtworkKey: 'rocket',
    },
    {
        key: 'raingutter',
        label: 'Raingutter Regatta',
        description: 'Sailboats blown down a rain gutter. Each entry is a "Boat".',
        vehicleSingular: 'Boat',
        vehiclePlural: 'Boats',
        vehicleArtworkKey: 'boat',
    },
];

/* ------------------------------------------------------------------ */
/* Who is holding it, and at what scale                                */
/* ------------------------------------------------------------------ */

export type OrganizationKindKey = 'cubScouts' | 'awana' | 'school' | 'other';

/** A single organization's own event, or a tournament between several. */
export type ScaleKey = 'own' | 'tournament';

/** A racing group the wizard offers ready-made, before the operator edits it. */
export interface GroupPreset {
    name: string;
    /** The group's Category — a Cub Scout rank, say. Blank where there is no natural one. */
    division: string;
    color: string;
}

export interface OrganizationWords {
    organizationSingular: string;
    organizationPlural: string;
    racingGroupSingular: string;
    racingGroupPlural: string;
}

export interface Scale extends OrganizationWords {
    key: ScaleKey;
    label: string;
    description: string;
}

export interface OrganizationKind extends OrganizationWords {
    key: OrganizationKindKey;
    label: string;
    description: string;
    /** Offered only where the answer changes the words — a district derby
     * is still Cub Scouts, but its groups are not dens. Absent means the
     * question is not asked. */
    scales?: readonly Scale[];
    /** Groups scaffolded on the next step. Empty means the operator starts
     * from a blank list — a school's grades are its own business. */
    presets: readonly GroupPreset[];
    /** What the Category box suggests for a group of this kind. */
    categoryPresets: readonly string[];
}

/** The traditional rank colours — Lion gold through Arrow of Light red — the
 * same six `backend/db/populate.py` gives its test roster, so a rehearsal
 * and a real race look alike. */
const CUB_SCOUT_PRESETS: readonly GroupPreset[] = [
    { name: 'Lion', division: 'Lion', color: '#F4D03F' },
    { name: 'Tiger', division: 'Tiger', color: '#E67E22' },
    { name: 'Wolf', division: 'Wolf', color: '#AAB7B8' },
    { name: 'Bear', division: 'Bear', color: '#85C1E9' },
    { name: 'Webelos', division: 'Webelos', color: '#2E86C1' },
    { name: 'Arrow of Light', division: 'Arrow of Light', color: '#CB4335' },
];

/** The Awana Grand Prix's age groups, in the order a child meets them. */
const AWANA_PRESET_NAMES = ['Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'] as const;

const AWANA_PRESETS: readonly GroupPreset[] = AWANA_PRESET_NAMES.map((name, i) => ({
    name,
    division: '',
    color: COMMON_COLORS[i % COMMON_COLORS.length],
}));

export const ORGANIZATION_KINDS: readonly OrganizationKind[] = [
    {
        key: 'cubScouts',
        label: 'Cub Scouts',
        description: 'Packs and dens — the words the app uses out of the box.',
        organizationSingular: 'Pack',
        organizationPlural: 'Packs',
        racingGroupSingular: 'Den',
        racingGroupPlural: 'Dens',
        scales: [
            {
                key: 'own',
                label: 'One pack’s own derby',
                description: 'Racers grouped by den.',
                organizationSingular: 'Pack',
                organizationPlural: 'Packs',
                racingGroupSingular: 'Den',
                racingGroupPlural: 'Dens',
            },
            {
                key: 'tournament',
                label: 'A district or council derby',
                description: 'Cars from several packs, raced by rank.',
                organizationSingular: 'District',
                organizationPlural: 'Districts',
                racingGroupSingular: 'Rank',
                racingGroupPlural: 'Ranks',
            },
        ],
        presets: CUB_SCOUT_PRESETS,
        categoryPresets: CATEGORY_PRESETS,
    },
    {
        key: 'awana',
        label: 'Awana',
        description: 'A Grand Prix — the club’s Cubbies, Sparks, T&T, Trek and Journey groups.',
        organizationSingular: 'Club',
        organizationPlural: 'Clubs',
        racingGroupSingular: 'Group',
        racingGroupPlural: 'Groups',
        presets: AWANA_PRESETS,
        categoryPresets: AWANA_PRESET_NAMES,
    },
    {
        key: 'school',
        label: 'A school',
        description: 'Racers grouped by grade. Add the grades that are racing on the next step.',
        organizationSingular: 'School',
        organizationPlural: 'Schools',
        racingGroupSingular: 'Grade',
        racingGroupPlural: 'Grades',
        presets: [],
        categoryPresets: [],
    },
    {
        key: 'other',
        label: 'Something else',
        description: 'Plain words — "Organization" and "Group" — that you can change later.',
        organizationSingular: 'Organization',
        organizationPlural: 'Organizations',
        racingGroupSingular: 'Group',
        racingGroupPlural: 'Groups',
        presets: [],
        categoryPresets: [],
    },
];

/* ------------------------------------------------------------------ */
/* Answers to words, and to groups                                     */
/* ------------------------------------------------------------------ */

export interface SetupAnswers {
    eventKind: EventKindKey;
    organizationKind: OrganizationKindKey;
    /** Read only where the organization kind offers scales. */
    scale: ScaleKey;
}

/** What the wizard opens on: the event this app was built for. */
export const DEFAULT_ANSWERS: SetupAnswers = {
    eventKind: 'pinewood',
    organizationKind: 'cubScouts',
    scale: 'own',
};

export function eventKindFor(key: EventKindKey): EventKind {
    return EVENT_KINDS.find((k) => k.key === key) ?? EVENT_KINDS[0];
}

export function organizationKindFor(key: OrganizationKindKey): OrganizationKind {
    return ORGANIZATION_KINDS.find((k) => k.key === key) ?? ORGANIZATION_KINDS[0];
}

/** The organization/group words an answer resolves to — the scale's, where
 * one is asked, else the kind's own. */
function organizationWordsFor(answers: SetupAnswers): OrganizationWords {
    const kind = organizationKindFor(answers.organizationKind);
    const scale = kind.scales?.find((s) => s.key === answers.scale);
    return scale ?? kind;
}

/** The seven words the answers add up to, fully resolved. */
export function wordsFor(answers: SetupAnswers): Terminology {
    const event = eventKindFor(answers.eventKind);
    const org = organizationWordsFor(answers);
    return {
        racingGroupSingular: org.racingGroupSingular,
        racingGroupPlural: org.racingGroupPlural,
        organizationSingular: org.organizationSingular,
        organizationPlural: org.organizationPlural,
        vehicleSingular: event.vehicleSingular,
        vehiclePlural: event.vehiclePlural,
        vehicleArtworkKey: event.vehicleArtworkKey,
    };
}

/** The seven per-race override fields `RaceFormData` carries. */
export type TerminologyOverrideFields = Pick<
    RaceFormData,
    | 'racing_group_singular'
    | 'racing_group_plural'
    | 'organization_singular'
    | 'organization_plural'
    | 'vehicle_singular'
    | 'vehicle_plural'
    | 'vehicle_artwork_key'
>;

const NO_OVERRIDE: TerminologyOverrideFields = {
    racing_group_singular: null,
    racing_group_plural: null,
    organization_singular: null,
    organization_plural: null,
    vehicle_singular: null,
    vehicle_plural: null,
    vehicle_artwork_key: null,
};

/**
 * What the new race should store: nothing, when the chosen words are exactly
 * the install's own default, else all seven as an explicit override.
 *
 * A race that says "Pack" and "Den" on an install whose default is already
 * "Pack" and "Den" should *inherit* — otherwise every race the wizard makes
 * opens its edit form with **Use different words for this race** ticked for
 * no reason, and a later change to the install-wide words would not reach
 * it. All seven or none, because that is the shape the edit form reads
 * (`RaceFormData` — the checkbox is on when the first is non-null).
 *
 * `installDefault` is the organization's *resolved* words from
 * `initialConfig.terminology` — deliberately not `useTerminology()`, which
 * inside a race route already holds that race's own override, and would
 * make "no change" mean "the same as the race I happen to be looking at".
 */
export function raceOverrideFor(
    words: Terminology,
    installDefault: Terminology = DEFAULT_TERMINOLOGY,
): TerminologyOverrideFields {
    const same = (Object.keys(words) as (keyof Terminology)[]).every(
        (k) => words[k] === installDefault[k],
    );
    if (same) return NO_OVERRIDE;
    return {
        racing_group_singular: words.racingGroupSingular,
        racing_group_plural: words.racingGroupPlural,
        organization_singular: words.organizationSingular,
        organization_plural: words.organizationPlural,
        vehicle_singular: words.vehicleSingular,
        vehicle_plural: words.vehiclePlural,
        vehicle_artwork_key: words.vehicleArtworkKey,
    };
}

/** A racing group as the wizard's groups step edits it — no id yet. */
export interface RacingGroupDraft {
    name: string;
    color: string;
    /** The Category box; blank for none. */
    division: string;
    car_number_range_start?: number;
    car_number_range_end?: number;
}

/**
 * The groups the answers scaffold, each with the number block Manage Dens
 * would have offered it in turn — 100–199, 200–299 — so a race set up here
 * numbers exactly as one set up by hand. Under global numbering the ranges
 * go unused, the same as they do for a group added by hand.
 */
export function scaffoldGroups(answers: SetupAnswers): RacingGroupDraft[] {
    const kind = organizationKindFor(answers.organizationKind);
    const drafts: RacingGroupDraft[] = [];
    for (const preset of kind.presets) {
        drafts.push(withSuggestedRange(drafts, preset));
    }
    return drafts;
}

/** A blank group to append, with the next free number block. */
export function blankGroup(existing: readonly RacingGroupDraft[]): RacingGroupDraft {
    return withSuggestedRange(existing, {
        name: '',
        division: '',
        color: COMMON_COLORS[existing.length % COMMON_COLORS.length],
    });
}

function withSuggestedRange(
    existing: readonly RacingGroupDraft[],
    preset: GroupPreset,
): RacingGroupDraft {
    const { start, end } = suggestedRange(existing);
    return { ...preset, car_number_range_start: start, car_number_range_end: end };
}

/* ------------------------------------------------------------------ */
/* Copying a previous race                                             */
/* ------------------------------------------------------------------ */

/** A racing group as `GET_RACE_SETUP_SOURCE` returns it. */
export interface SourceRacingGroup {
    name: string;
    color: string;
    division?: string | null;
    carNumberRangeStart?: number | null;
    carNumberRangeEnd?: number | null;
}

/** The previous race's settings the wizard copies — what that query returns. */
export interface SourceRace {
    id: number;
    location?: string | null;
    scoringStrategy: string;
    tiebreaker: string;
    dropWorstRuns: number;
    carNumberingStrategy: string;
    globalStartNumber: number;
    championshipTrophies: number;
    weightLimitOz?: number | null;
    racingGroupSingular?: string | null;
    racingGroupPlural?: string | null;
    organizationSingular?: string | null;
    organizationPlural?: string | null;
    vehicleSingular?: string | null;
    vehiclePlural?: string | null;
    vehicleArtworkKey?: string | null;
    racingGroups: readonly SourceRacingGroup[];
}

/** Last year's groups, exactly as they were — names, colours, categories
 * and number ranges — minus the ids, which belong to last year's race. */
export function copiedGroups(source: readonly SourceRacingGroup[]): RacingGroupDraft[] {
    return source.map((g) => ({
        name: g.name,
        color: g.color,
        division: g.division ?? '',
        car_number_range_start: g.carNumberRangeStart ?? undefined,
        car_number_range_end: g.carNumberRangeEnd ?? undefined,
    }));
}

/**
 * What the details step opens with when copying: the previous race's
 * scoring, numbering, check-in and words, and its venue — the same gym,
 * most years. Not its name or date, which are what make this a *new* race,
 * and not its QR-code text, which named that day's vote.
 *
 * The words are copied *raw* — null stays null — so a race that inherited
 * the install's words still inherits them, rather than freezing whatever
 * they resolved to the day it was copied.
 */
export function prefillFromRace(source: SourceRace): Partial<RaceFormData> {
    return {
        location: source.location ?? '',
        scoring_strategy: source.scoringStrategy,
        tiebreaker: source.tiebreaker,
        drop_worst_runs: source.dropWorstRuns,
        car_numbering_strategy: source.carNumberingStrategy,
        global_start_number: source.globalStartNumber,
        championship_trophies: source.championshipTrophies,
        weight_limit_oz: source.weightLimitOz ?? null,
        racing_group_singular: source.racingGroupSingular ?? null,
        racing_group_plural: source.racingGroupPlural ?? null,
        organization_singular: source.organizationSingular ?? null,
        organization_plural: source.organizationPlural ?? null,
        vehicle_singular: source.vehicleSingular ?? null,
        vehicle_plural: source.vehiclePlural ?? null,
        vehicle_artwork_key: source.vehicleArtworkKey ?? null,
    };
}

/* ------------------------------------------------------------------ */
/* The steps, and what stops one                                       */
/* ------------------------------------------------------------------ */

export type SetupMode = 'scratch' | 'copy';

export type StepId = 'start' | 'kind' | 'groups' | 'details';

/**
 * Which steps the wizard walks, in order.
 *
 * The start screen — scratch or copy — exists only once there is a race to
 * copy from; a first-time operator has no such choice and should not be
 * asked it. Copying skips the "what kind of event" questions altogether:
 * the answer is whatever the previous race was, and asking again would
 * invite a second answer that disagrees with the groups just copied.
 */
export function stepsFor(mode: SetupMode, hasPreviousRaces: boolean): StepId[] {
    if (mode === 'copy') return ['start', 'groups', 'details'];
    return hasPreviousRaces ? ['start', 'kind', 'groups', 'details'] : ['kind', 'groups', 'details'];
}

export interface GroupProblem {
    /** Which row, so the screen can point at it. */
    index: number;
    message: string;
}

/**
 * The first thing wrong with the groups list, or null.
 *
 * Names are the one thing a group cannot do without — every screen that
 * mentions a group prints its name — and two groups with the same name are
 * indistinguishable everywhere they appear. A range is optional, but a
 * backwards one would hand **Auto number** an empty block.
 */
export function firstGroupProblem(
    groups: readonly RacingGroupDraft[],
    words: { groupLower: string; groupsLower: string },
): GroupProblem | null {
    const seen = new Map<string, number>();
    for (const [index, group] of groups.entries()) {
        const name = group.name.trim();
        if (!name) {
            return { index, message: `Every ${words.groupLower} needs a name.` };
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
            return {
                index,
                message: `Two ${words.groupsLower} are both called “${name}” — give one a different name.`,
            };
        }
        seen.set(key, index);
        const { car_number_range_start: start, car_number_range_end: end } = group;
        if (start != null && end != null && end < start) {
            return {
                index,
                message: `${name}: the end number must not be lower than the start number.`,
            };
        }
    }
    return null;
}

/** A draft as `createRace`'s `racingGroups` takes it. */
export function toRacingGroupInput(draft: RacingGroupDraft) {
    return {
        name: draft.name.trim(),
        color: draft.color,
        division: draft.division.trim() || null,
        carNumberRangeStart: draft.car_number_range_start ?? null,
        carNumberRangeEnd: draft.car_number_range_end ?? null,
    };
}
