import { describe, expect, it } from 'vitest';
import {
    checklistFor as checklistForWords,
    nextStep,
    outstandingSteps,
    shouldCollapseChecklist,
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
    vehicle: 'Car',
    vehicles: 'Cars',
    groupLower: 'den',
    groupsLower: 'dens',
    orgLower: 'pack',
    orgsLower: 'packs',
    vehicleLower: 'car',
    vehiclesLower: 'cars',
    vehicleArtworkKey: 'car',
};

const checklistFor = (p: SetupProgress) => checklistForWords(p, WORDS);

const progress = (over: Partial<SetupProgress> = {}): SetupProgress => ({
    racingGroupCount: 0,
    racerCount: 0,
    checkedInCount: 0,
    roundCount: 0,
    awardCount: 0,
    isLocked: false,
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
            doneKeys(
                progress({
                    racingGroupCount: 3,
                    racerCount: 20,
                    checkedInCount: 20,
                    roundCount: 1,
                    awardCount: 2,
                }),
            ),
        ).toEqual(['racingGroups', 'racers', 'checkin', 'schedule', 'awards', 'printables']);
    });

    it('checking racers in also quiets the printables step, but not awards (#847)', () => {
        // Once check-in is under way, whatever printing was going to help
        // already has — the same "done at the first racer" shape the
        // checkin step itself uses. Awards has no such proxy: a pack that
        // never defines one is a decision only locking can express.
        const keys = doneKeys(progress({ racerCount: 20, checkedInCount: 1, roundCount: 1 }));
        expect(keys).toContain('printables');
        expect(keys).not.toContain('awards');
    });

    it('locking the race quiets both awards and printables even with neither done', () => {
        const keys = doneKeys(progress({ racerCount: 20, roundCount: 1, isLocked: true }));
        expect(keys).toContain('awards');
        expect(keys).toContain('printables');
    });

    it('an award on its own is enough for the awards step, with no lock needed', () => {
        expect(doneKeys(progress({ awardCount: 1 }))).toContain('awards');
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

    it('renders the default vehicle word exactly as before #551', () => {
        const [, , checkin] = checklistFor(progress());
        expect(checkin.label).toBe('Check in cars');
        expect(checkin.hint).toBe('Only checked-in cars are put into heats.');
    });

    // #849: the other three steps each name where to go — this one used to
    // state a fact and stop, the only step of the four with nothing to click.
    it('offers an action for the check-in step, unlike before #849', () => {
        const [, , checkin] = checklistFor(progress({ racerCount: 19 }));
        expect(checkin.action).not.toBeNull();
        expect(checkin.action).toBe('Select cars to check in');
    });

    it('needs a round for the schedule step, not merely racers', () => {
        expect(doneKeys(progress({ racerCount: 20, checkedInCount: 20 }))).not.toContain('schedule');
    });

    it('names the check-in step for the resolved vehicle word (#551)', () => {
        const rocketWords: TerminologyWords = {
            ...WORDS,
            vehicle: 'Rocket',
            vehicles: 'Rockets',
            vehicleLower: 'rocket',
            vehiclesLower: 'rockets',
        };
        const [, , checkin] = checklistForWords(progress(), rocketWords);
        expect(checkin.label).toBe('Check in rockets');
        expect(checkin.action).toBe('Select rockets to check in');
        expect(checkin.hint).toBe('Only checked-in rockets are put into heats.');
    });
});

describe('shouldShowChecklist', () => {
    it('shows while anything is outstanding', () => {
        expect(shouldShowChecklist(checklistFor(progress({ racerCount: 5 })))).toBe(true);
    });

    it('goes away once the race is set up, which is why there is no dismiss', () => {
        expect(
            shouldShowChecklist(
                checklistFor(
                    progress({
                        racingGroupCount: 2,
                        racerCount: 5,
                        checkedInCount: 5,
                        roundCount: 1,
                        awardCount: 1,
                    }),
                ),
            ),
        ).toBe(false);
    });

    it('stays up for an unlocked, award-less race even once racing has started', () => {
        // #847: a first-time operator can otherwise complete every step the
        // app used to ask of them and never be told awards exist.
        expect(
            shouldShowChecklist(
                checklistFor(
                    progress({ racingGroupCount: 2, racerCount: 5, checkedInCount: 5, roundCount: 1 }),
                ),
            ),
        ).toBe(true);
    });

    it('a locked race with no awards does not get lectured', () => {
        expect(
            shouldShowChecklist(
                checklistFor(
                    progress({
                        racingGroupCount: 2,
                        racerCount: 5,
                        checkedInCount: 5,
                        roundCount: 1,
                        isLocked: true,
                    }),
                ),
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
                checklistFor(
                    progress({
                        racingGroupCount: 1,
                        racerCount: 1,
                        checkedInCount: 1,
                        roundCount: 1,
                        awardCount: 1,
                    }),
                ),
            ),
        ).toBeNull();
    });

    it('points at awards once the schedule is generated', () => {
        expect(
            nextStep(
                checklistFor(
                    progress({ racingGroupCount: 1, racerCount: 1, checkedInCount: 1, roundCount: 1 }),
                ),
            )?.key,
        ).toBe('awards');
    });
});

describe('shouldCollapseChecklist (#949)', () => {
    it('stays expanded before anybody is checked in', () => {
        expect(shouldCollapseChecklist(progress({ racerCount: 20 }))).toBe(false);
    });

    it('collapses the moment check-in starts, whether or not a schedule exists yet', () => {
        // Plenty of packs start checking cars in before generating a round —
        // admitting them as latecomers once the schedule exists rather than
        // scheduling first. Requiring `roundCount > 0` here would leave the
        // checklist expanded through exactly the desk queue this collapses
        // it for.
        expect(shouldCollapseChecklist(progress({ racerCount: 20, checkedInCount: 1, roundCount: 0 }))).toBe(true);
    });

    it('stays collapsed once the schedule exists too', () => {
        expect(
            shouldCollapseChecklist(progress({ racerCount: 20, checkedInCount: 20, roundCount: 1 })),
        ).toBe(true);
    });
});

describe('outstandingSteps', () => {
    it('names only what is not done, in order', () => {
        const steps = checklistFor(progress({ racerCount: 20, checkedInCount: 1, roundCount: 1 }));
        expect(outstandingSteps(steps).map((step) => step.key)).toEqual(['awards']);
    });

    it('is empty once the checklist itself would disappear', () => {
        const steps = checklistFor(
            progress({ racingGroupCount: 1, racerCount: 1, checkedInCount: 1, roundCount: 1, awardCount: 1 }),
        );
        expect(outstandingSteps(steps)).toEqual([]);
    });
});
