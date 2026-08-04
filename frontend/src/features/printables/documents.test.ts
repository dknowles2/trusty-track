import { describe, expect, it } from 'vitest';
import {
    DOCUMENTS,
    barcodeSrc,
    formatEventDate,
    formatEventTime,
    inPrintOrder,
    parseIds,
    perSheet,
    racersToPrint,
    sheetCount,
    specFor,
    type PrintableRacer,
} from './documents';

const racer = (
    id: number,
    overrides: Partial<PrintableRacer> = {},
): PrintableRacer => ({
    id,
    first_name: `First${id}`,
    last_name: `Last${id}`,
    ...overrides,
});

describe('inPrintOrder', () => {
    it('stacks the cards in car-number order', () => {
        const sorted = inPrintOrder([
            racer(1, { car_number: 12 }),
            racer(2, { car_number: 3 }),
            racer(3, { car_number: 7 }),
        ]);

        expect(sorted.map((r) => r.car_number)).toEqual([3, 7, 12]);
    });

    it('sorts numerically, not as text', () => {
        // The roster carries numbers as strings from the form; sorted as text,
        // car 10 lands between 1 and 2 and the stack is unusable.
        const sorted = inPrintOrder([
            racer(1, { car_number: '10' }),
            racer(2, { car_number: '9' }),
            racer(3, { car_number: '100' }),
        ]);

        expect(sorted.map((r) => r.car_number)).toEqual(['9', '10', '100']);
    });

    it('puts racers with no number at the end, alphabetically', () => {
        // They are the ones still needing a number. Buried mid-stack, nobody
        // notices until they are handing passes out.
        const sorted = inPrintOrder([
            racer(1, { last_name: 'Young' }),
            racer(2, { car_number: 5, last_name: 'Adams' }),
            racer(3, { last_name: 'Baker' }),
        ]);

        expect(sorted.map((r) => r.last_name)).toEqual(['Adams', 'Baker', 'Young']);
    });

    it('treats an empty car number as no number at all', () => {
        const sorted = inPrintOrder([
            racer(1, { car_number: '' }),
            racer(2, { car_number: 4 }),
        ]);

        expect(sorted.map((r) => r.id)).toEqual([2, 1]);
    });

    it('does not reorder the caller’s array', () => {
        const roster = [racer(1, { car_number: 9 }), racer(2, { car_number: 1 })];

        inPrintOrder(roster);

        expect(roster.map((r) => r.id)).toEqual([1, 2]);
    });
});

describe('racersToPrint', () => {
    it('prints everyone when nothing was selected', () => {
        // Arriving from the roster with no ticks means "the whole roster",
        // which is what printing before check-in opens actually is.
        const printed = racersToPrint([racer(1), racer(2)], []);

        expect(printed).toHaveLength(2);
    });

    it('prints only the selection when there is one', () => {
        const printed = racersToPrint([racer(1), racer(2), racer(3)], [3, 1]);

        expect(printed.map((r) => r.id)).toEqual([1, 3]);
    });

    it('ignores a selected racer who is no longer on the roster', () => {
        // The roster refetches; a racer deleted in another tab must not print
        // a blank card or break the page.
        const printed = racersToPrint([racer(1)], [1, 99]);

        expect(printed.map((r) => r.id)).toEqual([1]);
    });

    it('sorts the selection too', () => {
        const printed = racersToPrint(
            [racer(1, { car_number: 8 }), racer(2, { car_number: 2 })],
            [1, 2],
        );

        expect(printed.map((r) => r.car_number)).toEqual([2, 8]);
    });
});

describe('parseIds', () => {
    it('reads the ids the roster handed over', () => {
        expect(parseIds('3,1,2')).toEqual([3, 1, 2]);
    });

    it.each([null, '', '  '])('treats %o as no selection', (raw) => {
        expect(parseIds(raw)).toEqual([]);
    });

    it('drops junk rather than refusing the whole parameter', () => {
        // A hand-edited URL should still print something.
        expect(parseIds('1,abc,,2,-3,0,4.5')).toEqual([1, 2]);
    });
});

describe('sheet geometry', () => {
    it.each(DOCUMENTS)('fits $label on a sheet of Letter', (spec) => {
        // Every card has to fit the printable area with the half-inch margin
        // the stylesheet sets, or the browser silently drops a column.
        expect(spec.widthIn * spec.columns).toBeLessThanOrEqual(7.5);
        expect(spec.heightIn).toBeLessThanOrEqual(10);
        expect(perSheet(spec)).toBeGreaterThan(0);
    });

    it('counts a full sheet of business cards', () => {
        expect(perSheet(specFor('drivers-license'))).toBe(10);
    });

    it('rounds a part-used sheet up', () => {
        // 11 cards is two sheets of paper, not 1.1.
        expect(sheetCount(11, specFor('drivers-license'))).toBe(2);
    });

    it('is no sheets when there is nothing to print', () => {
        expect(sheetCount(0, specFor('pit-pass'))).toBe(0);
    });
});

describe('specFor', () => {
    it('finds a document by kind', () => {
        expect(specFor('check-in-code').label).toBe('Check-in codes');
    });

    it.each([null, undefined, 'nonsense'])(
        'falls back to the first document for %o',
        (kind) => {
            // The kind comes from the URL, so it can be anything.
            expect(specFor(kind).kind).toBe(DOCUMENTS[0].kind);
        },
    );
});

describe('barcodeSrc', () => {
    it('points at the endpoint the backend serves', () => {
        // Kept in step with `check_in_barcode` in backend/api/main.py; the
        // `/api` prefix is what the Vite dev proxy and production both expect.
        expect(barcodeSrc(42)).toBe('/api/printables/barcode/42.png');
    });
});

describe('event dates', () => {
    it('writes a date a scout can read', () => {
        expect(formatEventDate('2026-03-14T09:30:00')).toContain('2026');
        expect(formatEventDate('2026-03-14T09:30:00')).not.toContain('T');
    });

    it('writes a time of day', () => {
        expect(formatEventTime('2026-03-14T09:30:00')).toMatch(/9[:.]30/);
    });

    it.each([null, undefined, '', 'not a date'])(
        'prints nothing rather than "Invalid Date" for %o',
        (value) => {
            expect(formatEventDate(value)).toBe('');
            expect(formatEventTime(value)).toBe('');
        },
    );
});
