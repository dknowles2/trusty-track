import { describe, it, expect } from 'vitest';
import {
    firstProblem,
    isRaceSectionId,
    RACE_SECTIONS,
    scoringNeedsATimerNote,
    sectionsFor,
} from './raceSettingsSections';
import { SCORING_STRATEGY_OPTIONS } from '../stats/scoringStrategyText';

describe('which sections are offered', () => {
    it('gives the edit form one entry per section, in order', () => {
        expect(sectionsFor(true).map((s) => s.id)).toEqual([
            'event',
            'scoring',
            'checkin',
            'words',
            'appearance',
            'displays',
        ]);
    });

    it('gives the create form none, because a wizard is not sectioned', () => {
        // Somebody filling the form in for the first time meets every field
        // once, in order. The caller reads an empty list as "render the lot".
        expect(sectionsFor(false)).toHaveLength(0);
    });

    it('says what each section is for, without naming the built-in words', () => {
        // The blurb is the only thing on screen telling an operator they are
        // in the right place, so an empty one is a section with no signpost.
        // And the last section exists so a race can replace "den", "pack"
        // and "car" — a blurb using them would be wrong the moment it did.
        for (const section of RACE_SECTIONS) {
            expect(section.label).not.toBe('');
            expect(section.blurb).not.toBe('');
            expect(section.blurb).not.toMatch(/\b(den|pack|car)s?\b/i);
        }
    });
});

describe('isRaceSectionId', () => {
    it('accepts every real section id', () => {
        for (const section of RACE_SECTIONS) {
            expect(isRaceSectionId(section.id)).toBe(true);
        }
    });

    it('rejects anything else, including null, undefined and a near-miss', () => {
        expect(isRaceSectionId('scoring ')).toBe(false);
        expect(isRaceSectionId('Scoring')).toBe(false);
        expect(isRaceSectionId('nonsense')).toBe(false);
        expect(isRaceSectionId(null)).toBe(false);
        expect(isRaceSectionId(undefined)).toBe(false);
    });
});

describe('what stops a save', () => {
    const race = (overrides: Partial<Parameters<typeof firstProblem>[0]> = {}) => ({
        name: 'Pack 42 Derby',
        championship_trophies: 3,
        weight_limit_oz: 5,
        ...overrides,
    });

    it('passes a filled-in form', () => {
        expect(firstProblem(race())).toBeNull();
    });

    it('passes a race with the weight check off and no custom words', () => {
        expect(firstProblem(race({ weight_limit_oz: null }))).toBeNull();
    });

    it('sends a missing name to Event', () => {
        // The section matters as much as the message: with one section on
        // screen at a time, the offending field is usually not the one being
        // looked at, and the browser cannot point at a field it is not
        // rendering.
        expect(firstProblem(race({ name: '   ' }))).toEqual({
            section: 'event',
            message: 'The race needs a name.',
        });
    });

    it('sends an out-of-range trophy count to Scoring', () => {
        // Restates the input's own `min`/`max`, for the case where the input
        // is not on screen.
        expect(firstProblem(race({ championship_trophies: 0 }))?.section).toBe('scoring');
        expect(firstProblem(race({ championship_trophies: 11 }))?.section).toBe('scoring');
        expect(firstProblem(race({ championship_trophies: 2.5 }))?.section).toBe('scoring');
        expect(firstProblem(race({ championship_trophies: 10 }))).toBeNull();
        expect(firstProblem(race({ championship_trophies: 1 }))).toBeNull();
    });

    it('sends a weight limit of nothing to Check-in, but only while the check is on', () => {
        expect(firstProblem(race({ weight_limit_oz: 0 }))?.section).toBe('checkin');
        expect(firstProblem(race({ weight_limit_oz: -1 }))?.section).toBe('checkin');
        // Null is "no check", not "a limit of nothing" (#205).
        expect(firstProblem(race({ weight_limit_oz: null }))).toBeNull();
    });

    it('sends a blank custom word to Words and names', () => {
        // The terminology inputs never carried `required`, and `updateRace`
        // does not refuse an empty string — so this is the one rule here
        // that is new rather than a restatement of an input's own attribute.
        const words = {
            racing_group_singular: 'Class',
            racing_group_plural: 'Classes',
            organization_singular: 'School',
            organization_plural: 'Schools',
            vehicle_singular: 'Rocket',
            vehicle_plural: 'Rockets',
        };
        expect(firstProblem(race(words))).toBeNull();
        expect(firstProblem(race({ ...words, vehicle_plural: '  ' }))?.section).toBe('words');
        expect(firstProblem(race({ ...words, organization_singular: '' }))?.section).toBe('words');
    });

    it('ignores the words entirely while the override is off', () => {
        // All seven travel together: a null first word means the override
        // is off, whatever the others hold.
        expect(firstProblem(race({ racing_group_singular: null, vehicle_plural: '' }))).toBeNull();
    });

    it('reports the earliest section first', () => {
        // One problem at a time, in the order the sections are offered, so
        // fixing them walks the operator forward through the form rather
        // than bouncing them about.
        expect(firstProblem(race({ name: '', championship_trophies: 0 }))?.section).toBe('event');
        expect(firstProblem(race({ championship_trophies: 0, weight_limit_oz: 0 }))?.section).toBe('scoring');
    });
});

describe('scoringNeedsATimerNote (#1324)', () => {
    // A no-timer track with a time-based scoring strategy — Timed,
    // Cumulative time or Fastest single run — is the combination Enter
    // Results has no way to record a finishing order for: every one of the
    // three shows a Time column only (`isTimeBasedStrategy` in
    // `features/racing/lanes.ts`). A first version of this predicate fired
    // only for `=== TIMED`, missing that Cumulative time and Fastest single
    // run share the identical gap — this table pins all four strategies
    // against a no-timer track, not just the one the issue's own
    // reproduction walked through.
    const NOTE = /no electronic timer/i;
    const TIMED_WORDING = 'Timing by stopwatch? Choose Timed.';
    // Named, not "this method": the note renders above the radio list, so a
    // bare "this" has no antecedent beside it (found in review). The name is
    // the option's own label, so it matches the radio the operator clicked.
    const STILL_WORKS = (label: string) => `Timing by stopwatch? ${label} still works.`;

    it('warns for Timed scoring on a track with no timer, with the issue\'s own wording', () => {
        const note = scoringNeedsATimerNote('TIMED', 'NONE');
        expect(note).toMatch(NOTE);
        expect(note).toContain(TIMED_WORDING);
    });

    it('warns for Cumulative time and Fastest single run too — they share Timed\'s no-Place-column gap', () => {
        for (const strategy of ['CUMULATIVE_TIME', 'FASTEST_TIME']) {
            const note = scoringNeedsATimerNote(strategy, 'NONE');
            const label = SCORING_STRATEGY_OPTIONS.find(option => option.value === strategy)!.label;
            expect(note).toMatch(NOTE);
            // Not the Timed-specific wording — the operator is already on a
            // time-based strategy, so "Choose Timed" would point at a third
            // option nobody asked about. The second half — Points is the
            // answer for calling a finish by eye — is identical either way.
            expect(note).toContain(STILL_WORKS(label));
            expect(note).toContain('Judging finish order by eye? Choose Points.');
            expect(note).not.toContain(TIMED_WORDING);
        }
    });

    it('falls back to "This method" for a strategy the options list has never heard of', () => {
        // `isTimeBasedStrategy` is `!== 'POINTS'`, so an unrecognized string
        // is treated as time-based and reaches the named-method branch with
        // no label to use. Nothing can produce one today; a fifth strategy
        // added to the backend enum before this list would.
        expect(scoringNeedsATimerNote('SOMETHING_NEW', 'NONE')).toContain(
            'Timing by stopwatch? This method still works.',
        );
    });

    it('says nothing for Points on a no-timer track — that combination already works', () => {
        expect(scoringNeedsATimerNote('POINTS', 'NONE')).toBeNull();
    });

    it('says nothing for any time-based strategy once a track with a real timer is chosen', () => {
        for (const strategy of ['TIMED', 'CUMULATIVE_TIME', 'FASTEST_TIME']) {
            expect(scoringNeedsATimerNote(strategy, 'FAKE')).toBeNull();
            expect(scoringNeedsATimerNote(strategy, 'AUTO_DETECT_BACKEND')).toBeNull();
            expect(scoringNeedsATimerNote(strategy, 'AUTO_DETECT_PROXY')).toBeNull();
        }
    });

    it('says nothing once no track is selected yet, or the track query has not answered', () => {
        for (const strategy of ['TIMED', 'CUMULATIVE_TIME', 'FASTEST_TIME']) {
            expect(scoringNeedsATimerNote(strategy, null)).toBeNull();
            expect(scoringNeedsATimerNote(strategy, undefined)).toBeNull();
        }
    });
});
