/**
 * Reading a scanned check-in code back into a racer.
 *
 * Pure, and the mirror of `backend/domain/printables.py` — that file writes
 * the payload, this one reads it. Both hold `TT1:<race_id>:<racer_id>` and
 * both have a round-trip test; if one changes, so does the other.
 */

/** Bumped only if the meaning of the fields changes. Matches the backend. */
export const VERSION = 'TT1';

export interface CheckInCode {
    raceId: number;
    racerId: number;
}

/** A racer, as far as scanning is concerned. */
export interface ScannableRacer {
    id: number;
    first_name: string;
    last_name: string;
    car_number?: number | string;
}

/**
 * What a scan turned out to be.
 *
 * Four outcomes rather than a racer-or-nothing, because the operator's next
 * move differs for each: try again, use a different sheet, check the roster,
 * or carry on.
 */
export type ScanResult =
    | { status: 'ok'; racerId: number }
    /** Not one of ours at all — a cereal box, a bus ticket, a future format. */
    | { status: 'not-a-code' }
    /** Ours, but printed for another race. Last year's pass, most likely. */
    | { status: 'wrong-race'; raceId: number }
    /** This race, but nobody holds that id now. Deleted since printing. */
    | { status: 'unknown-racer' };

/**
 * Read a scanned payload, or `null` if it is not one of ours.
 *
 * An unknown version is refused rather than guessed at: that is the entire
 * reason the tag is on the paper.
 */
export function decodeCheckIn(payload: string): CheckInCode | null {
    const parts = payload.trim().split(':');
    if (parts.length !== 3) return null;

    const [version, race, racer] = parts;
    if (version !== VERSION) return null;

    const raceId = Number(race);
    const racerId = Number(racer);
    if (!Number.isInteger(raceId) || !Number.isInteger(racerId)) return null;
    if (raceId <= 0 || racerId <= 0) return null;

    return { raceId, racerId };
}

/** What this scan means for the race currently open. */
export function resolveScan(
    payload: string,
    raceId: number,
    racers: readonly ScannableRacer[],
): ScanResult {
    const code = decodeCheckIn(payload);
    if (!code) return { status: 'not-a-code' };
    if (code.raceId !== raceId) return { status: 'wrong-race', raceId: code.raceId };
    if (!racers.some((r) => r.id === code.racerId)) return { status: 'unknown-racer' };
    return { status: 'ok', racerId: code.racerId };
}

/**
 * What typing a car number turned out to find.
 *
 * `none` and `ambiguous` used to collapse into the same `null` — the operator
 * was told a car clearly numbered X did not exist, when in fact two racers
 * held it. Manual numbering allows duplicates, so `ambiguous` is refused
 * rather than guessed at: picking the first would check in the wrong child,
 * silently. Distinguishing the two here is what lets the caller tell them
 * apart on screen (issue #336).
 */
export type CarNumberMatch =
    | { status: 'ok'; racer: ScannableRacer }
    /** Nothing typed, or nothing on the roster holds this number. */
    | { status: 'none' }
    /** More than one racer holds this number — find them by name instead. */
    | { status: 'ambiguous' };

/**
 * The fallback: a car number typed in.
 *
 * Wanted on every browser, not only the ones that cannot scan — a code gets
 * creased, a camera will not focus, and the operator has a queue.
 */
export function matchByCarNumber(
    racers: readonly ScannableRacer[],
    typed: string,
): CarNumberMatch {
    const wanted = typed.trim();
    if (!wanted) return { status: 'none' };

    const matches = racers.filter(
        (r) => r.car_number != null && String(r.car_number).trim() === wanted,
    );
    if (matches.length === 0) return { status: 'none' };
    if (matches.length > 1) return { status: 'ambiguous' };
    return { status: 'ok', racer: matches[0] };
}

/**
 * Whether this browser can scan at all.
 *
 * `BarcodeDetector` is Chromium-only. Rather than take on a decode library for
 * the others — the same trade the browser-proxied serial timer already makes —
 * Safari and Firefox get the car-number entry, which is why that is not hidden
 * behind a "cannot scan" branch.
 */
export function canScan(): boolean {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}
