/**
 * What the race form is divided into, and what stops a save (#587).
 *
 * The form had grown to one 500px column holding, in edit mode, a lock, a
 * name, a date, a location, two five-option fieldsets, four numeric inputs,
 * six checkboxes and — behind two of those — seven more text boxes and a
 * radio group. An operator who opened it to turn on the weight check had
 * to scroll past the scoring rules to find it. The same thing happened to
 * System Settings first, and the answer is the same one (`settings/
 * sections.ts`): a section per question the operator is actually asking,
 * one on screen at a time, and a nav down the side to move between them.
 *
 * Pure, and tested on its own: this is the *rule* about the form, and the
 * doing is in `RaceForm.tsx`. Same split as `raceFlow.ts`.
 */

export type RaceSectionId = 'event' | 'scoring' | 'checkin' | 'words';

export interface RaceSection {
    id: RaceSectionId;
    /** What the nav calls it, and what the docs call it. */
    label: string;
    /** One line under the heading, for a reader who is not sure they are here. */
    blurb: string;
}

/**
 * The sections in the order they are offered.
 *
 * Grouped by the question an operator opens the form with, not by where a
 * column lives on the backend. "Which track" is an event fact and sits with
 * the name and date; "how many go to the final" is about who wins and sits
 * with scoring; the words a race uses and how much of a name a public
 * screen shows are both about what strangers read, and share a section.
 *
 * The blurbs deliberately name no built-in vocabulary — no "den", "pack" or
 * "car" — since the last section exists precisely so a race can replace
 * those words, and a blurb that used them would be wrong the moment it did.
 */
export const RACE_SECTIONS: readonly RaceSection[] = [
    {
        id: 'event',
        label: 'Event',
        blurb: 'What the race is called, when and where it runs, and which track it runs on.',
    },
    {
        id: 'scoring',
        label: 'Scoring',
        blurb: 'How the standings are worked out, how ties are settled, and who takes which trophy.',
    },
    {
        id: 'checkin',
        label: 'Check-in',
        blurb: 'How numbers are handed out, and what the scale checks.',
    },
    {
        id: 'words',
        label: 'Words and names',
        blurb: "What this race calls things, and how much of a racer's name a public screen shows.",
    },
];

/**
 * Which sections a nav should offer.
 *
 * Creating a race is the wizard case, and a wizard is not sectioned:
 * somebody filling the form in for the first time should meet every field
 * once, in order, rather than be asked to go looking for the two they have
 * not filled in yet. So the create form gets no nav at all — the caller
 * renders the lot, under the same headings, which is what teaches the
 * vocabulary the edit form is later navigated by. This mirrors
 * `settings/sections.ts`'s `sectionsFor` exactly, and for the same reason.
 *
 * Note that "Words and names" holds nothing at all while creating — both of
 * its controls are update-only, since `updateRace` is the only mutation that
 * accepts them — so a flat create form simply has three headings, not four.
 */
export function sectionsFor(isEditing: boolean): readonly RaceSection[] {
    return isEditing ? RACE_SECTIONS : [];
}

/** The `min` and `max` the Championship Trophies input carries. */
export const MIN_CHAMPIONSHIP_TROPHIES = 1;
export const MAX_CHAMPIONSHIP_TROPHIES = 10;

/** A race, as far as validation cares. Structurally a subset of `RaceFormData`. */
export interface RaceForValidation {
    name: string;
    championship_trophies: number;
    weight_limit_oz?: number | null;
    racing_group_singular?: string | null;
    racing_group_plural?: string | null;
    organization_singular?: string | null;
    organization_plural?: string | null;
    vehicle_singular?: string | null;
    vehicle_plural?: string | null;
}

export interface RaceProblem {
    /** Where the operator has to go to fix it. */
    section: RaceSectionId;
    message: string;
}

/**
 * The first thing wrong with the form, or null.
 *
 * The inputs still carry `required`, `min` and `max`, which is what catches a
 * bad value in the section on screen — the browser points straight at the
 * field. This exists for the value the browser *cannot* point at: with one
 * section rendered at a time, an empty race name is not in the document
 * while somebody is on Scoring, so nothing native would fire and the save
 * would go up missing a name. Same reasoning, and the same shape, as
 * `settings/sections.ts`'s `firstProblem`.
 *
 * Every rule here restates a constraint an input already carries, with one
 * addition: a custom word left blank. The terminology inputs never carried
 * `required` at all, and `updateRace` does not refuse an empty string, so
 * an operator could save a race whose word for its racing groups was "" —
 * which then rendered as nothing everywhere the word is used. The docs had
 * promised "there is no way to save an empty word" the whole time.
 */
export function firstProblem(race: RaceForValidation): RaceProblem | null {
    if (!race.name.trim()) {
        return { section: 'event', message: 'The race needs a name.' };
    }
    const trophies = race.championship_trophies;
    if (
        !Number.isInteger(trophies) ||
        trophies < MIN_CHAMPIONSHIP_TROPHIES ||
        trophies > MAX_CHAMPIONSHIP_TROPHIES
    ) {
        return {
            section: 'scoring',
            message: `Championship Trophies must be between ${MIN_CHAMPIONSHIP_TROPHIES} and ${MAX_CHAMPIONSHIP_TROPHIES}.`,
        };
    }
    if (race.weight_limit_oz != null && !(race.weight_limit_oz > 0)) {
        return {
            section: 'checkin',
            message: 'The weight limit must be more than zero — or untick the weight check.',
        };
    }
    // The override is on exactly when the first word is non-null; all seven
    // travel together (see `RaceFormData`), so one null means none are set.
    if (race.racing_group_singular != null) {
        const words = [
            race.racing_group_singular,
            race.racing_group_plural,
            race.organization_singular,
            race.organization_plural,
            race.vehicle_singular,
            race.vehicle_plural,
        ];
        if (words.some((word) => !word?.trim())) {
            return {
                section: 'words',
                message:
                    'Every custom word needs a value — fill in each box, or untick "Use different words for this race" to go back to the built-in words.',
            };
        }
    }
    return null;
}
