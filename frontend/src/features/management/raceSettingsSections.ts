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

import { isTimeBasedStrategy } from '../racing/lanes';
import { TIMED } from '../stats/scoringStrategyText';

export type RaceSectionId =
    | 'event'
    | 'scoring'
    | 'checkin'
    | 'words'
    | 'appearance'
    | 'displays';

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
 * What the QR code display screen says is its own section rather than
 * riding along with Event, for the reason `RaceForm.tsx` explains at that
 * section's own JSX (#945): it serves one audience-display view most packs
 * never assign, and it was sitting in front of the scoring decision every
 * race needs.
 *
 * Appearance (#1081) sits beside Words and names, not beside Displays —
 * "what strangers read" and "what strangers see" are the same audience
 * (the wall screen, the pit pass) asking a different question, where
 * Displays above is about one specific view's own call-to-action text, not
 * the whole event's look.
 *
 * The blurbs deliberately name no built-in vocabulary — no "den", "pack" or
 * "car" — since the words section exists precisely so a race can replace
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
    {
        id: 'appearance',
        label: 'Appearance',
        blurb: 'The look of the wall display and printed documents for this race.',
    },
    {
        id: 'displays',
        label: 'Displays',
        blurb: 'What the QR code screen says.',
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
 * Note that "Words and names", "Appearance" and "Displays" all hold nothing
 * at all while creating — "Words and names" because both its controls are
 * update-only; "Appearance" (#1081) for the same reason, and because a new
 * race has nothing to override yet anyway, the same "inherits" starting
 * point a fresh install's own Display/Printables pickers have; and
 * "Displays" because the QR code headline and Wi-Fi guidance, while
 * accepted at creation by the mutation, are offered on the edit form only
 * (#945): they serve one audience-display view most packs never assign, and
 * the create form is the one screen every organizer sees, so a flat create
 * form simply has three headings, not six.
 */
export function sectionsFor(isEditing: boolean): readonly RaceSection[] {
    return isEditing ? RACE_SECTIONS : [];
}

/**
 * Whether a value names one of the form's sections.
 *
 * The one caller today is `RaceDetails.tsx`'s `?section=` query parameter,
 * which opens the edit form straight onto a chosen section rather than the
 * default (`RaceForm`'s own `initialSection` prop, #970) — a stray or
 * misspelled value in a hand-typed or bookmarked URL should fall back to
 * the form's default section, not land on no section at all, which is what
 * `RaceForm`'s `shows()` would do for an id none of `RACE_SECTIONS` holds.
 */
export function isRaceSectionId(value: string | null | undefined): value is RaceSectionId {
    return RACE_SECTIONS.some((section) => section.id === value);
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

/**
 * The inline note the Scoring section shows when the chosen scoring
 * strategy and the track's own timer disagree about how a result gets
 * entered (#1324).
 *
 * Every time-based strategy's Enter Results modal asks for a time only
 * (`showsPlaceColumn`/`shouldDerivePlaces`, which both key off
 * `isTimeBasedStrategy` in `features/racing/lanes.ts`) — a real timer
 * supplies it, and a volunteer with a stopwatch can still type one by hand,
 * so any of `TIMED`/`CUMULATIVE_TIME`/`FASTEST_TIME` on a `NONE`-timer
 * track is a legitimate pairing, not a bug on its own. What is missing is
 * anyone telling the *other* population that shares the same track
 * setting: a pack with no timing device of any kind, who mean to call the
 * finish by eye. They need `POINTS` instead, and nothing said so until
 * they opened their first heat's Enter Results and found no way to type an
 * order at all.
 *
 * A first version of this predicate fired only for `TIMED` — the one case
 * the issue's own reproduction walks through — but `isTimeBasedStrategy`'s
 * own docstring already says why that undercounts: `CUMULATIVE_TIME` and
 * `FASTEST_TIME` (#547) are exactly as time-based as `TIMED`, share the
 * identical Enter Results shape, and a no-timer pack that lands on either
 * one hits the same missing-Place-column trap with no signpost at all.
 * Narrowing to `=== TIMED` is the "not spelled out at each call site"
 * mistake that docstring warns against, reintroduced one level up. `POINTS`
 * is the only strategy with no gap here, so the condition below is
 * `isTimeBasedStrategy`, not a re-derived `!== 'POINTS'` and not a literal
 * `=== TIMED`.
 *
 * The wording still splits on `TIMED` specifically, though: "Timing by
 * stopwatch? Choose Timed." reads correctly only when Timed is not already
 * the race's own choice. Under Cumulative time or Fastest single run the
 * operator has already chosen a time-based strategy, so the note says the
 * chosen method still works with a stopwatch rather than pointing at a
 * third strategy nobody asked about — the second half, "Judging finish
 * order by eye? Choose Points.", is identical either way, since Points is
 * the one answer for calling a finish by eye regardless of which
 * time-based strategy was current.
 *
 * Deliberately a separate predicate from `tiebreakerWontFire`
 * (`features/stats/tiebreakText.ts`), not a case folded into it: that one
 * says why a *tiebreak method* can't settle a tie (a question about
 * `Race.tiebreaker`); this one says why the *scoring strategy itself*
 * leaves no way to record a result at all (a question about
 * `Race.scoringStrategy`). Extending `tiebreakerWontFire` to also flag a
 * time-based strategy plus `NONE` would be wrong, not merely a different
 * topic — under any of the three, a no-timer track's results are real,
 * hand-typed elapsed times, so `BEST_TIME`/`TOTAL_TIME` can genuinely
 * compare them; only the `POINTS` + `NONE` combination that predicate
 * already flags ever leaves no time on record. What the two predicates
 * share is the *mechanism* — a short note computed live from this race's
 * own scoring and the selected track's timer, shown beside the relevant
 * control rather than left for the operator to discover on race day —
 * reused here for a different question, in the same Scoring section.
 *
 * One function serves both signposts the issue asks for, because both are
 * the same combination of facts: the setup wizard's Details step *is*
 * `RaceForm` in its flat create mode (`RaceSetupWizard.tsx`), so a single
 * call site in `RaceForm.tsx`'s Scoring fieldset reaches the wizard and
 * the edit form alike — the latter is what makes a race edited after
 * creation, or a track whose timer type changed later, get the identical
 * note rather than a second copy that could drift from the first.
 */
export function scoringNeedsATimerNote(
    scoringStrategy: string,
    trackTimerType: string | null | undefined,
): string | null {
    if (trackTimerType !== 'NONE' || !isTimeBasedStrategy(scoringStrategy)) {
        return null;
    }
    return scoringStrategy === TIMED
        ? 'This track has no electronic timer. Timing by stopwatch? Choose Timed. Judging finish order by eye? Choose Points.'
        : 'This track has no electronic timer. Timing by stopwatch? This method still works. Judging finish order by eye? Choose Points.';
}
