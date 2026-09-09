/**
 * What is being raced, and who is holding it — the pre-canned vocabulary
 * `RaceSetupWizard.tsx` turns a couple of questions into the seven words
 * `Terminology` carries (#662). Moved here from `features/management/
 * raceSetup.ts` (#928): it started as that wizard's own private data, but
 * it is vocabulary two feature slices need — the roster's racing-group
 * Category picker (`features/management/components/RacingGroupManager.tsx`)
 * derives its suggestions from the same table, and the install-wide default
 * on `features/settings/pages/SystemSettings.tsx` asks the same two
 * questions in front of its six word fields. `context/` is where
 * `TerminologyContext.tsx`'s `DEFAULT_TERMINOLOGY` already lives for
 * exactly this reason — both sides already import from here, so this is a
 * move rather than a copy. Two lists of organization kinds free to disagree
 * would be worse than either home.
 *
 * Nothing here is a new vocabulary the backend has to learn. An answer
 * resolves to the same seven nullable columns `updateRace` and
 * `updateInitialConfig` have accepted since #496, plus ordinary
 * `RacingGroupInput` rows built by `raceSetup.ts`'s `scaffoldGroups`.
 *
 * The option labels below name the built-in words on purpose ("Packs and
 * dens") — the same reason `SystemSettings.tsx`'s terminology labels are
 * allowlisted by `terminologyGuard.test.ts`: an option that *chooses* a
 * vocabulary has to say which one it chooses. They live here, in data,
 * rather than in a screen's JSX, because they are the rule about what an
 * answer means, not display copy the answer controls.
 */

import type { Terminology } from './TerminologyContext';
import { CATEGORY_PRESETS } from './categoryPresets';
import { COMMON_COLORS } from '../utils/colors';

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
/* Answers to words                                                    */
/* ------------------------------------------------------------------ */

export interface SetupAnswers {
    eventKind: EventKindKey;
    organizationKind: OrganizationKindKey;
    /** Read only where the organization kind offers scales. */
    scale: ScaleKey;
}

/** What a picker opens on: the event this app was built for. */
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

/**
 * What the roster's Category picker should suggest for a racing group,
 * derived from the *resolved* organization/racing-group words rather than
 * anything stored (#928, part 1).
 *
 * `RacingGroupManager` has no direct way to know which `OrganizationKind`
 * an install or a race chose — nothing records it, on purpose, the same
 * "computed on demand, never stored" rule the standings, awards recipients
 * and track records already follow (storing the kind would be a second
 * source of truth an operator could put out of step with the words
 * themselves by editing just one of them). So this matches the resolved
 * `organizationSingular`/`racingGroupSingular` pair against every kind
 * *and* every scale it offers — a district derby's "District"/"Rank" is
 * still Cub Scouts underneath, and its ranks are exactly what the top-level
 * kind's `categoryPresets` already holds. A pair matching nothing (a school,
 * "Something else", or a custom vocabulary typed by hand) yields no
 * suggestions at all, which is the honest answer rather than a guess.
 */
export function categoryPresetsFor(words: {
    organizationSingular: string;
    racingGroupSingular: string;
}): readonly string[] {
    for (const kind of ORGANIZATION_KINDS) {
        const candidates: readonly OrganizationWords[] = [kind, ...(kind.scales ?? [])];
        const matches = candidates.some(
            (c) =>
                c.organizationSingular === words.organizationSingular &&
                c.racingGroupSingular === words.racingGroupSingular,
        );
        if (matches) return kind.categoryPresets;
    }
    return [];
}
