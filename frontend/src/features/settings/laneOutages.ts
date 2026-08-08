/**
 * Which of a track's lanes are out of service (#171).
 *
 * The toggling is separated from the screen because it is a set operation with
 * an ordering guarantee — the server stores a set, and a list that came back
 * `[4, 2]` would render the checkboxes in that order.
 */

/** Turn one lane's outage on or off, keeping the result sorted. */
export function toggleLane(outages: number[], lane: number): number[] {
  const next = outages.includes(lane)
    ? outages.filter((l) => l !== lane)
    : [...outages, lane];
  return next.sort((a, b) => a - b);
}

/** `1..laneCount`, for rendering a control per lane. */
export function lanesOf(laneCount: number): number[] {
  return Array.from({ length: Math.max(0, laneCount) }, (_, i) => i + 1);
}

/**
 * What to tell the operator about a track's current state.
 *
 * Deliberately says how many lanes remain rather than only which are broken:
 * "3 of 4 lanes in use" is the number that decides whether the event can go
 * ahead, and a track down to none cannot run a heat at all.
 */
export function outageSummary(laneCount: number, outages: number[]): string {
  const usable = laneCount - outages.length;
  if (outages.length === 0) return `All ${laneCount} lanes in use`;
  if (usable <= 0) return 'No usable lanes — no schedule can be generated';
  const list = outages.join(', ');
  const plural = outages.length === 1 ? 'Lane' : 'Lanes';
  return `${usable} of ${laneCount} lanes in use — ${plural} ${list} out of service`;
}
