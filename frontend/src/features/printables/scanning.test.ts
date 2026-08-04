import { describe, expect, it } from 'vitest';
import {
    canScan,
    decodeCheckIn,
    matchByCarNumber,
    resolveScan,
    VERSION,
    type ScannableRacer,
} from './scanning';

const racer = (id: number, car?: number | string): ScannableRacer => ({
    id,
    first_name: `First${id}`,
    last_name: `Last${id}`,
    car_number: car,
});

describe('decodeCheckIn', () => {
    it('reads the payload the backend prints', () => {
        // Pinned as a literal on both sides — `test_printables.py` asserts the
        // same string — so a change to one shows up as a failure in the other.
        expect(decodeCheckIn('TT1:3:42')).toEqual({ raceId: 3, racerId: 42 });
    });

    it('tolerates what a scanner appends', () => {
        expect(decodeCheckIn('  TT1:1:2\r\n ')).toEqual({ raceId: 1, racerId: 2 });
    });

    it.each([
        '',
        '42',
        'TT1:42',
        'TT1:1:2:3',
        'TT1:one:two',
        'TT1::',
        'TT1:0:2',
        'TT1:1:-2',
        'TT1:1.5:2',
        'https://example.com/coupon',
    ])('refuses %o', (payload) => {
        expect(decodeCheckIn(payload)).toBeNull();
    });

    it('refuses a version it does not know rather than guessing', () => {
        // The whole reason the tag is on the paper: a pass printed by a later
        // version must not be read under today's rules.
        expect(decodeCheckIn('TT9:1:2')).toBeNull();
        expect(VERSION).toBe('TT1');
    });
});

describe('resolveScan', () => {
    const roster = [racer(7), racer(8)];

    it('finds the racer', () => {
        expect(resolveScan('TT1:1:7', 1, roster)).toEqual({ status: 'ok', racerId: 7 });
    });

    it('says a foreign code is not ours', () => {
        expect(resolveScan('buy one get one free', 1, roster)).toEqual({
            status: 'not-a-code',
        });
    });

    it('will not check in a racer from another race', () => {
        // Last year's pass in a scout's box. Racer 7 exists in this race too,
        // and checking them in would be checking in the wrong child.
        expect(resolveScan('TT1:2:7', 1, roster)).toEqual({
            status: 'wrong-race',
            raceId: 2,
        });
    });

    it('says so when the racer has gone since the code was printed', () => {
        expect(resolveScan('TT1:1:99', 1, roster)).toEqual({ status: 'unknown-racer' });
    });
});

describe('matchByCarNumber', () => {
    it('finds the one racer with that number', () => {
        expect(matchByCarNumber([racer(1, 7), racer(2, 12)], '12')?.id).toBe(2);
    });

    it('matches a number the roster holds as a string', () => {
        expect(matchByCarNumber([racer(1, '7')], '7')?.id).toBe(1);
    });

    it('ignores surrounding spaces', () => {
        expect(matchByCarNumber([racer(1, 7)], ' 7 ')?.id).toBe(1);
    });

    it('refuses to guess when two racers share a number', () => {
        // Manual numbering allows duplicates. Picking the first would check in
        // the wrong child, silently.
        expect(matchByCarNumber([racer(1, 7), racer(2, 7)], '7')).toBeNull();
    });

    it('matches nothing on an empty entry', () => {
        // A racer whose number was cleared holds an empty string, which an
        // empty entry would otherwise match — check-in by pressing Find on a
        // blank box.
        expect(matchByCarNumber([racer(1, ''), racer(2, 7)], '  ')).toBeNull();
    });

    it('does not match a racer who has no number', () => {
        expect(matchByCarNumber([racer(1)], '0')).toBeNull();
    });
});

describe('canScan', () => {
    it('is false without BarcodeDetector', () => {
        // jsdom has none, which is also Safari and Firefox.
        expect(canScan()).toBe(false);
    });

    it('is true where the browser provides one', () => {
        (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {};
        try {
            expect(canScan()).toBe(true);
        } finally {
            delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
        }
    });
});
