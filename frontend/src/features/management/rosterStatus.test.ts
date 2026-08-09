import { describe, expect, it } from 'vitest';
import { rosterStatus, statusLabel, statusNotice } from './rosterStatus';

const checkedIn = (id: number) => ({ id, carPassedInspection: true });
const notCheckedIn = (id: number) => ({ id, carPassedInspection: false });

describe('rosterStatus', () => {
    it('says nothing about anybody before a round is generated', () => {
        // Nobody is in a heat yet, which is the ordinary state of a roster
        // being built. Flagging everybody here is the fastest way to teach an
        // operator that the badge means nothing.
        expect(rosterStatus(checkedIn(1), [], false)).toBe('RACING');
    });

    it('flags a checked-in racer who is in no heat once heats exist', () => {
        expect(rosterStatus(checkedIn(7), [1, 2, 3], true)).toBe('NOT_IN_ANY_HEAT');
    });

    it('leaves a racer who is in a heat alone', () => {
        expect(rosterStatus(checkedIn(2), [1, 2, 3], true)).toBe('RACING');
    });

    it('reports not-checked-in ahead of everything else', () => {
        // They are not missing from the schedule, they are not eligible for it
        // — `car_passed_inspection` is what the generator fields from, so the
        // operator's next action is the check-in button, not a new round.
        expect(rosterStatus(notCheckedIn(9), [1, 2, 3], true)).toBe('NOT_CHECKED_IN');
    });

    it('does not flag a racer who has not checked in even with no heats', () => {
        expect(rosterStatus(notCheckedIn(9), [], false)).toBe('NOT_CHECKED_IN');
    });
});

describe('what the operator is told', () => {
    it('explains the only case that admission cannot fix', () => {
        expect(statusNotice('NOT_IN_ANY_HEAT')).toContain('next round');
    });

    it('says nothing for a racer who is racing', () => {
        expect(statusNotice('RACING')).toBeNull();
        expect(statusLabel('RACING')).toBeNull();
    });

    it('says nothing for a racer who has not checked in', () => {
        // The check-in button is already right there saying it.
        expect(statusNotice('NOT_CHECKED_IN')).toBeNull();
        expect(statusLabel('NOT_CHECKED_IN')).toBeNull();
    });

    it('keeps the badge short enough to sit beside the check-in button', () => {
        expect(statusLabel('NOT_IN_ANY_HEAT')!.length).toBeLessThanOrEqual(12);
    });
});
