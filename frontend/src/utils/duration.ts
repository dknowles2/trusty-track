import { ESTIMATED_HEAT_DURATION_MIN } from './constants';

/**
 * "~1 min" / "~2 mins" — the schedule estimate, pluralised.
 *
 * Four screens built this string themselves and all four read "~1 mins" for a
 * single remaining heat, which is the commonest number to see: it is what the
 * operator screen shows for the whole of the last heat of every round.
 */
export function minutesEstimate(minutes: number): string {
    return `~${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
}

/** The same estimate for a number of heats still to run. */
export function heatsEstimate(heats: number): string {
    return minutesEstimate(Math.ceil(heats * ESTIMATED_HEAT_DURATION_MIN));
}
