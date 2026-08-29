import { describe, expect, it } from 'vitest';
import {
    isCompact,
    overallLevel,
    readinessItems,
    shouldShowReadiness,
    summaryLine,
    type ReadinessInput,
    type ReadinessKey,
    type ReadinessLevel,
} from './readiness';

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
    timerState: 'IDLE',
    timerDeviceName: 'MicroWizard',
    timerProvenance: null,
    timerType: 'AUTO_DETECT_BACKEND',
    registeredCount: 20,
    checkedInCount: 20,
    heatCount: 20,
    connectedDisplays: 2,
    ...over,
});

const levelOf = (key: ReadinessKey, over: Partial<ReadinessInput> = {}): ReadinessLevel =>
    readinessItems(input(over)).find((item) => item.key === key)!.level;

const detailOf = (key: ReadinessKey, over: Partial<ReadinessInput> = {}): string =>
    readinessItems(input(over)).find((item) => item.key === key)!.detail;

describe('the timer item', () => {
    it('is fine on an idle timer', () => {
        expect(levelOf('timer')).toBe('OK');
    });

    it('blocks when the timer is disconnected', () => {
        expect(levelOf('timer', { timerState: 'DISCONNECTED' })).toBe('BLOCKED');
    });

    it('blocks on a fault', () => {
        expect(levelOf('timer', { timerState: 'FAULT' })).toBe('BLOCKED');
    });

    it('blocks while the device has not said what it is', () => {
        // CONNECTED means the port is open and nothing has identified itself —
        // the state nudge_if_unidentified exists to get out of. Reporting it as
        // ready is how an operator finds out at the start line.
        expect(levelOf('timer', { timerState: 'CONNECTED' })).toBe('BLOCKED');
    });

    it('is not a verdict before the first payload arrives', () => {
        expect(levelOf('timer', { timerState: null })).toBe('INFO');
    });

    it('stays usable while a heat is under way', () => {
        expect(levelOf('timer', { timerState: 'RUNNING' })).toBe('OK');
    });

    it('is fine, not blocked, on a track with no timer at all (#490)', () => {
        // A track configured with no timer sits its manager in IDLE forever
        // (`services/timer/devices/no_timer.py`), which would otherwise read
        // as an ordinary usable timer — and it is not one.
        expect(levelOf('timer', { timerType: 'NONE', timerState: 'IDLE' })).toBe('OK');
        expect(detailOf('timer', { timerType: 'NONE', timerState: 'IDLE' })).toBe(
            'No timer — results are entered by hand.',
        );
    });

    it('a no-timer track overrides a disconnected reading', () => {
        // `timerType` is the intended configuration; a stale or synthetic
        // `timerState` must not turn it back into a fault.
        expect(levelOf('timer', { timerType: 'NONE', timerState: 'DISCONNECTED' })).toBe('OK');
    });

    it('does not go amber over an untested profile', () => {
        // Every profile shipped says it has never been driven live, including
        // the MicroWizard written from the manufacturer's own documentation.
        // An amber on that basis would be on for every track every time, and an
        // indicator that is always on is an indicator nobody reads. This is the
        // real string, not a paraphrase — a warning written from the same notes
        // as the profile would agree with the profile's mistakes.
        expect(
            levelOf('timer', {
                timerProvenance:
                    "Adapted from DerbyNet's NewBold profile (MIT, © Jeff Piazza). Never run "
                    + 'against this hardware by Trusty Track — treat as a starting point and '
                    + 'report what actually happens.',
            }),
        ).toBe('OK');
    });

    it('carries the provenance as a note rather than a verdict', () => {
        const item = readinessItems(input({ timerProvenance: 'Never driven live.' })).find(
            (i) => i.key === 'timer',
        )!;

        expect(item.note).toBe('Never driven live.');
    });

    it('has no note when the profile does not offer one', () => {
        const item = readinessItems(input({ timerProvenance: '' })).find((i) => i.key === 'timer')!;

        expect(item.note).toBeUndefined();
    });

    it('sends the operator to the diagnostics page, which is where the detail lives', () => {
        const item = readinessItems(input()).find((i) => i.key === 'timer')!;

        expect(item.href).toBe('/timer-check');
    });
});

describe('the check-in item', () => {
    it('blocks on an empty roster', () => {
        expect(levelOf('checkin', { registeredCount: 0, checkedInCount: 0 })).toBe('BLOCKED');
    });

    it('blocks when nobody is checked in', () => {
        expect(levelOf('checkin', { checkedInCount: 0 })).toBe('BLOCKED');
    });

    it('is amber, not red, part-way through', () => {
        // A queue at the desk is the ordinary state of a race morning. Red for
        // the whole of check-in is crying wolf.
        expect(levelOf('checkin', { checkedInCount: 12 })).toBe('ATTENTION');
    });

    it('counts, so the operator can see how far off they are', () => {
        expect(detailOf('checkin', { checkedInCount: 12, registeredCount: 20 })).toContain(
            '12 of 20',
        );
    });

    it('is fine once everybody is through', () => {
        expect(levelOf('checkin')).toBe('OK');
    });
});

describe('the schedule item', () => {
    it('blocks with no heats', () => {
        expect(levelOf('schedule', { heatCount: 0 })).toBe('BLOCKED');
    });

    it('does not say "1 heats"', () => {
        expect(detailOf('schedule', { heatCount: 1 })).toContain('1 heat ');
    });
});

describe('the displays item', () => {
    it('never passes judgement, because having no screens is a choice', () => {
        expect(levelOf('displays', { connectedDisplays: 0 })).toBe('INFO');
        expect(levelOf('displays', { connectedDisplays: 3 })).toBe('INFO');
    });

    it('says how many, which is the thing worth knowing', () => {
        expect(detailOf('displays', { connectedDisplays: 3 })).toContain('3 screens');
    });

    it('does not say "1 screens"', () => {
        expect(detailOf('displays', { connectedDisplays: 1 })).toContain('1 screen ');
    });
});

describe('overallLevel', () => {
    it('takes the worst thing on the list', () => {
        expect(overallLevel(readinessItems(input({ heatCount: 0, checkedInCount: 3 })))).toBe(
            'BLOCKED',
        );
    });

    it('reports attention when nothing is blocking', () => {
        expect(overallLevel(readinessItems(input({ checkedInCount: 3 })))).toBe('ATTENTION');
    });

    it('is not dragged down by an informational item', () => {
        // Otherwise a race with no audience screen could never read as ready.
        expect(overallLevel(readinessItems(input({ connectedDisplays: 0 })))).toBe('OK');
    });
});

describe('isCompact', () => {
    it('collapses once nothing wants attention', () => {
        expect(isCompact(readinessItems(input()))).toBe(true);
    });

    it('expands again for anything amber', () => {
        expect(isCompact(readinessItems(input({ checkedInCount: 1 })))).toBe(false);
    });
});

describe('summaryLine', () => {
    it('carries the facts rather than only claiming readiness', () => {
        const line = summaryLine(readinessItems(input({ heatCount: 15 })));

        expect(line).toContain('MicroWizard');
        expect(line).toContain('All 20 checked in');
        expect(line).toContain('15 heats');
    });

    it('leaves the display count out of the one-liner', () => {
        expect(summaryLine(readinessItems(input({ connectedDisplays: 2 })))).not.toContain('screen');
    });
});

describe('shouldShowReadiness', () => {
    it('is a pre-flight check, so it goes once the race is under way', () => {
        expect(shouldShowReadiness(true)).toBe(false);
    });

    it('is there before the first heat is recorded', () => {
        expect(shouldShowReadiness(false)).toBe(true);
    });
});
