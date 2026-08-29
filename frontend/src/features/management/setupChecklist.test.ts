import { describe, expect, it } from 'vitest';
import {
    checklistFor as checklistForWords,
    nextStep,
    shouldShowChecklist,
    type SetupProgress,
    type StepKey,
} from './setupChecklist';
import type { TerminologyWords } from '../../context/TerminologyContext';

const WORDS: TerminologyWords = {
    group: 'Den',
    groups: 'Dens',
    org: 'Pack',
    orgs: 'Packs',
    groupLower: 'den',
    groupsLower: 'dens',
    orgLower: 'pack',
    orgsLower: 'packs',
};

const checklistFor = (p: SetupProgress) => checklistForWords(p, WORDS);

const progress = (over: Partial<SetupProgress> = {}): SetupProgress => ({
    racingGroupCount: 0,
    racerCount: 0,
    checkedInCount: 0,
    roundCount: 0,
    ...over,
});

const doneKeys = (p: SetupProgress): StepKey[] =>
    checklistFor(p)
        .filter((step) => step.done)
        .map((step) => step.key);

describe('checklistFor', () => {
    it('has nothing done on a race that was just created', () => {
        expect(doneKeys(progress())).toEqual([]);
    });

    it('ticks every step off once the race is set up', () => {
        expect(
            doneKeys(progress({ racingGroupCount: 3, racerCount: 20, checkedInCount: 20, roundCount: 1 })),
        ).toEqual(['racingGroups', 'racers', 'checkin', 'schedule']);
    });

    it('counts the racingGroups step done once there is a roster, even with no racingGroups', () => {
        // A pack that numbers cars some other way never creates a racingGroup, and a
        // step that can never be completed teaches the operator to ignore the
        // whole checklist.
        expect(doneKeys(progress({ racerCount: 12 }))).toContain('racingGroups');
    });

    it('still asks for racingGroups on an empty race', () => {
        expect(doneKeys(progress({ racingGroupCount: 0, racerCount: 0 }))).not.toContain('racingGroups');
    });

    it('counts check-in done at the first racer rather than the last', () => {
        // The last car often arrives after the first heat. Requiring the whole
        // roster would leave the checklist up through the racing.
        expect(doneKeys(progress({ racerCount: 60, checkedInCount: 1 }))).toContain('checkin');
    });

    it('keeps counting in the hint after the step is ticked', () => {
        const [, , checkin] = checklistFor(progress({ racerCount: 60, checkedInCount: 43 }));

        expect(checkin.done).toBe(true);
        expect(checkin.hint).toContain('43 of 60');
    });

    it('does not offer a count before there is anybody to count', () => {
        const [, , checkin] = checklistFor(progress());

        expect(checkin.hint).not.toContain('0 of 0');
    });

    it('needs a round for the schedule step, not merely racers', () => {
        expect(doneKeys(progress({ racerCount: 20, checkedInCount: 20 }))).not.toContain('schedule');
    });
});

describe('shouldShowChecklist', () => {
    it('shows while anything is outstanding', () => {
        expect(shouldShowChecklist(checklistFor(progress({ racerCount: 5 })))).toBe(true);
    });

    it('goes away once the race is set up, which is why there is no dismiss', () => {
        expect(
            shouldShowChecklist(
                checklistFor(progress({ racingGroupCount: 2, racerCount: 5, checkedInCount: 5, roundCount: 1 })),
            ),
        ).toBe(false);
    });
});

describe('nextStep', () => {
    it('points at the first thing outstanding', () => {
        expect(nextStep(checklistFor(progress()))?.key).toBe('racingGroups');
    });

    it('skips past what is already done', () => {
        expect(nextStep(checklistFor(progress({ racerCount: 8 })))?.key).toBe('checkin');
    });

    it('is nothing once everything is done', () => {
        expect(
            nextStep(
                checklistFor(progress({ racingGroupCount: 1, racerCount: 1, checkedInCount: 1, roundCount: 1 })),
            ),
        ).toBeNull();
    });
});
