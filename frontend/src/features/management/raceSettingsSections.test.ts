import { describe, it, expect } from 'vitest';
import { firstProblem, RACE_SECTIONS, sectionsFor } from './raceSettingsSections';

describe('which sections are offered', () => {
    it('gives the edit form one entry per section, in order', () => {
        expect(sectionsFor(true).map((s) => s.id)).toEqual(['event', 'scoring', 'checkin', 'words']);
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
