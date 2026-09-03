/**
 * Estimated duration of a single heat in minutes, before there is any real
 * pace to learn from — before the first heat of a race, and for the first
 * couple of heats after (`features/racing/pace.ts`'s `MIN_PACE_SAMPLES`).
 *
 * A bare 1 minute is the time a car is actually on the track; it counts
 * neither the walk to stage the next heat nor the reset once it finishes,
 * which is why real heats reported #591 as running 1.5 to 2.5 minutes apiece.
 * 1.75 is the midpoint of the issue's own narrower "1.5 to 2 minutes"
 * suggestion — a schedule estimate is a guess an operator plans an evening
 * around, and once racing starts the learned pace in `pace.ts` replaces it
 * with this race's own turnaround time.
 */
export const ESTIMATED_HEAT_DURATION_MIN = 1.75;
