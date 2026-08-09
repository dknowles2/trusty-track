/**
 * Whether a car is over the pack's weight limit (#205).
 *
 * The check-in form has always recorded a weight "for documentation purposes",
 * which misses the reason anybody weighs a car. The rule is 5.0 oz in most
 * packs, the dispute happens at the scale with a queue behind it, and the app
 * should back up the volunteer holding the car.
 *
 * Pure, and it is deliberately advisory. The inspector decides; this only makes
 * the rule visible at the moment it matters.
 */

export type WeightVerdict = 'NO_LIMIT' | 'NOT_WEIGHED' | 'UNDER' | 'OVER';

/**
 * The tolerance, in ounces.
 *
 * Scales disagree in the last decimal place and 5.01 on the desk scale is 5.00
 * on the pack's — refusing a car over a hundredth of an ounce is a rule about
 * the equipment rather than about the car. `0.005` is half of the smallest
 * amount a two-decimal scale can show, so a car that *reads* 5.00 always
 * passes a 5.0 limit and one that reads 5.01 does not.
 */
export const TOLERANCE_OZ = 0.005;

export function weightVerdict(
    weight: number | null | undefined,
    limit: number | null | undefined,
): WeightVerdict {
    if (limit == null) return 'NO_LIMIT';
    // Zero is not a weight anybody recorded — the field is empty and the
    // browser gave us a falsy number. Treating it as a very light car would
    // put a green tick against a car nobody has put on the scale.
    if (weight == null || weight <= 0) return 'NOT_WEIGHED';
    return weight > limit + TOLERANCE_OZ ? 'OVER' : 'UNDER';
}

/** What to say beside the field, or null when there is nothing to say. */
export function weightNotice(verdict: WeightVerdict, limit: number | null | undefined): string | null {
    if (verdict !== 'OVER' || limit == null) return null;
    return `Over the ${formatOunces(limit)} oz limit for this race.`;
}

/** Trailing zeroes are noise on a limit that is nearly always a round number. */
export function formatOunces(value: number): string {
    return Number(value.toFixed(2)).toString();
}

/** The default offered to a new race, which is the near-universal pack rule. */
export const DEFAULT_LIMIT_OZ = 5;
