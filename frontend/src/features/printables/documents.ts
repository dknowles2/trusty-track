/**
 * What gets printed, and in what order.
 *
 * Pure — no React, no urql. The layout numbers live here rather than in the
 * stylesheet because the page also has to say "3 sheets" before the operator
 * commits paper to it, and a card size kept in two places drifts.
 */

/** A racer, as far as a printable is concerned. */
export interface PrintableRacer {
    id: number;
    first_name: string;
    last_name: string;
    car_number?: number | string;
    car_name?: string;
    racing_group_id?: number;
    racer_image_url?: string;
    /** The inspected weight, in ounces — read by the car label (#617) for
     * the impound-pit weight field. Absent or `0` both mean "not weighed",
     * the same convention `weightVerdict` uses. */
    car_weight?: number | null;
}

/** The event, as far as a printable is concerned. */
export interface PrintableRace {
    name: string;
    dateTime?: string | null;
    location?: string | null;
}

/** A racingGroup, for the colour flash on a card. */
export interface PrintableRacingGroup {
    id: number;
    name: string;
    color: string;
}

export type DocumentKind = 'pit-pass' | 'drivers-license' | 'check-in-code' | 'car-sticker';

export interface DocumentSpec {
    kind: DocumentKind;
    /** What the operator picks it by. */
    label: string;
    /** What they get, in the terms they would describe it in. */
    blurb: string;
    /** Inches. Letter paper with a half-inch margin leaves 7.5in x 10in. */
    widthIn: number;
    heightIn: number;
    columns: number;
}

export const DOCUMENTS: readonly DocumentSpec[] = [
    {
        kind: 'pit-pass',
        label: 'Pit passes',
        blurb: 'Lanyard sized. Photo, name, and the event details.',
        widthIn: 3.5,
        // Deep enough for a photo above the name, shallow enough that three
        // rows fit a sheet. At 4.5in only two rows fit and the third of the
        // page below them is thrown away on every print run.
        heightIn: 3.25,
        columns: 2,
    },
    {
        kind: 'drivers-license',
        label: "Driver's licences",
        // Business-card stock is the reason for the size: an operator who wants
        // these on card rather than paper can buy the sheets anywhere.
        blurb: 'Business-card sized. Racer, car name, and car number.',
        widthIn: 3.5,
        heightIn: 2,
        columns: 2,
    },
    {
        kind: 'check-in-code',
        label: 'Check-in codes',
        blurb: 'The QR code with a name under it, for scanning at check-in.',
        widthIn: 2.5,
        heightIn: 2.5,
        columns: 3,
    },
    {
        kind: 'car-sticker',
        label: 'Car labels',
        blurb: 'For the underside of the car or the impound box: number, name, den, weight and a scan code.',
        // Sized for Avery 5163 (2in x 4in shipping labels, 10 per Letter
        // sheet, 2 columns x 5 rows). Avery's own template uses a 0.5in
        // top/bottom margin — which is exactly PAGE_HEIGHT_IN below, so 5
        // rows of a true 2in-tall label already land pixel-for-pixel on the
        // die cuts — but a 0.156in *side* margin, narrower than the flat
        // 0.5in every other document on this page assumes (`PAGE_WIDTH_IN`,
        // and the shared `@page` rule in `PrintSheet.css`). Two literal 4in
        // columns need 8in of width and only 7.5in is on offer under that
        // shared assumption, so the card is 3.75in wide rather than 4in —
        // two columns of 3.75in fill the 7.5in exactly. That keeps the
        // count and grid (10 per sheet, 2x5) Avery's own layout promises,
        // at the cost of a bit of unused margin inside each real die-cut
        // label rather than the sticker running edge to edge.
        widthIn: 3.75,
        heightIn: 2,
        columns: 2,
    },
];

/** The usable area of a sheet of Letter paper at the half-inch margin below. */
const PAGE_WIDTH_IN = 7.5;
const PAGE_HEIGHT_IN = 10;

export function specFor(kind: string | null | undefined): DocumentSpec {
    return DOCUMENTS.find((d) => d.kind === kind) ?? DOCUMENTS[0];
}

/** How many of these fit on one sheet. */
export function perSheet(spec: DocumentSpec): number {
    const columns = Math.min(spec.columns, Math.floor(PAGE_WIDTH_IN / spec.widthIn));
    return columns * Math.floor(PAGE_HEIGHT_IN / spec.heightIn);
}

/** How many sheets this many cards will take. */
export function sheetCount(cards: number, spec: DocumentSpec): number {
    return Math.ceil(cards / perSheet(spec));
}

/**
 * The ids in a `?racers=` parameter.
 *
 * Anything that is not a number is dropped rather than rejected: the parameter
 * is a convenience carried over from the roster's selection, and a corrupted
 * one should print something rather than nothing.
 */
export function parseIds(raw: string | null): number[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Sort for the order the cards will be handed out in.
 *
 * Car number first, because that is how the roster is read out and how a stack
 * of passes gets matched to arrivals. Racers with no number sort to the end,
 * alphabetically — they are the ones the operator still has to do something
 * about, and burying them in the middle of the stack hides that.
 */
export function inPrintOrder<T extends PrintableRacer>(racers: readonly T[]): T[] {
    return [...racers].sort((a, b) => {
        const numberA = Number(a.car_number);
        const numberB = Number(b.car_number);
        const hasA = a.car_number != null && a.car_number !== '' && !Number.isNaN(numberA);
        const hasB = b.car_number != null && b.car_number !== '' && !Number.isNaN(numberB);

        if (hasA && hasB) return numberA - numberB;
        if (hasA) return -1;
        if (hasB) return 1;

        return (
            (a.last_name || '').localeCompare(b.last_name || '') ||
            (a.first_name || '').localeCompare(b.first_name || '')
        );
    });
}

/**
 * The racers to print, given the roster and whatever the roster's selection
 * carried in. An empty selection means the whole roster: nobody prints one pit
 * pass, and arriving here from the "Print" button with nothing ticked means
 * "all of them", not "none of them".
 */
export function racersToPrint<T extends PrintableRacer>(
    racers: readonly T[],
    selectedIds: readonly number[],
): T[] {
    const wanted = new Set(selectedIds);
    const chosen = wanted.size === 0 ? racers : racers.filter((r) => wanted.has(r.id));
    return inPrintOrder(chosen);
}

/** Where the QR image for this racer comes from. */
export function barcodeSrc(racerId: number): string {
    return `/api/printables/barcode/${racerId}.png`;
}

/**
 * The event date as it should read on a pit pass — a scout reads the date off
 * it, not a timestamp. Anything unparseable prints nothing rather than
 * "Invalid Date".
 */
export function formatEventDate(dateTime: string | null | undefined): string {
    if (!dateTime) return '';
    const parsed = new Date(dateTime);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/** The start time, for a pass that has to say when to turn up. */
export function formatEventTime(dateTime: string | null | undefined): string {
    if (!dateTime) return '';
    const parsed = new Date(dateTime);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
