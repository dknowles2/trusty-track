import { describe, it, expect } from 'vitest';
import { firstProblem, isFormSection, SECTIONS, sectionsFor } from './sections';

describe('which sections are offered', () => {
    it('gives a configured install one entry per section', () => {
        expect(sectionsFor(true).map((s) => s.id)).toEqual([
            'general',
            'appearance',
            'access',
            'tracks',
            'backup',
        ]);
    });

    it('gives the first run none, because a wizard is not sectioned', () => {
        // Somebody who has never seen the app meets every field once, in
        // order. The caller reads an empty list as "render the lot".
        expect(sectionsFor(false)).toHaveLength(0);
    });

    it('keeps Backup outside the form', () => {
        // A Restore button under a submit button saying "Save Settings" is one
        // misclick away from replacing the event.
        expect(isFormSection('backup')).toBe(false);
        expect(SECTIONS.filter((s) => isFormSection(s.id)).map((s) => s.id)).toEqual([
            'general',
            'appearance',
            'access',
            'tracks',
        ]);
    });

    it('says what each section is for', () => {
        // The blurb is the only thing on screen telling an operator they are
        // in the right place, so an empty one is a section with no signpost.
        for (const section of SECTIONS) {
            expect(section.label).not.toBe('');
            expect(section.blurb).not.toBe('');
        }
    });
});

describe('what stops a save', () => {
    const track = (name: string, laneCount = 4, scaleRatio = 25) => ({ name, laneCount, scaleRatio });

    it('passes a filled-in form', () => {
        expect(firstProblem('Pack 42', [track('Main Track')])).toBeNull();
    });

    it('sends a missing organization name to General', () => {
        // The section matters as much as the message: with one section on
        // screen at a time, the offending field is usually not the one being
        // looked at, and the browser cannot point at a field it is not
        // rendering.
        expect(firstProblem('   ', [track('Main Track')])).toEqual({
            section: 'general',
            message: 'Your organization needs a name — for example Pack 123.',
        });
    });

    it('names the example in whatever the operator just called the organization (#532)', () => {
        // The organization name and the terminology fields are in the same
        // section — an operator who renamed "Pack" to "Squad" and left the
        // name blank should see "Squad 123", not the vocabulary they just
        // replaced.
        expect(firstProblem('   ', [track('Main Track')], 'Squad')).toEqual({
            section: 'general',
            message: 'Your organization needs a name — for example Squad 123.',
        });
    });

    it('names the track at fault by its number', () => {
        expect(firstProblem('Pack 42', [track('Main Track'), track('')])).toEqual({
            section: 'tracks',
            message: 'Track 2 needs a name.',
        });
    });

    it('refuses a lane count no track could have', () => {
        expect(firstProblem('Pack 42', [track('Main Track', 9)])).toEqual({
            section: 'tracks',
            message: 'Main Track needs between 1 and 8 lanes.',
        });
        expect(firstProblem('Pack 42', [track('Main Track', 0)])?.section).toBe('tracks');
    });

    it('refuses a non-positive scale ratio (#610)', () => {
        // The server refuses this too (`scale_ratio_is_positive`), whatever
        // "Show scale speed" is set to — a value nothing could ever use is
        // wrong to store, not just wrong to display.
        expect(firstProblem('Pack 42', [track('Main Track', 4, 0)])).toEqual({
            section: 'tracks',
            message: 'Main Track needs a scale ratio greater than zero.',
        });
        expect(firstProblem('Pack 42', [track('Main Track', 4, -1)])?.section).toBe('tracks');
    });

    it('refuses a race with no track at all', () => {
        expect(firstProblem('Pack 42', [])).toEqual({
            section: 'tracks',
            message: 'At least one track is required.',
        });
    });

    it('reports the organization before the tracks', () => {
        // One problem at a time, and the first one in reading order — a list
        // of everything wrong is a wall of red on a half-filled form.
        expect(firstProblem('', [])?.section).toBe('general');
    });
});
