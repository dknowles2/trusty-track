/**
 * Saying out loud how many cars are racing but not ranked (#548).
 *
 * The flag itself is set on the roster; this is the standings page's and
 * the results sheet's half of "an excluded car needs to look excluded, or
 * the operator will assume the app has lost it" — a count rather than a
 * shorter list with no explanation.
 */

/** How many of a roster's racers are flagged, or 0 for none. */
export function excludedCount(racers: { excludedFromStandings: boolean }[]): number {
  return racers.filter((r) => r.excludedFromStandings).length;
}

/**
 * What to tell the reader, or null when nobody is excluded.
 *
 * `vehicleLower` and `vehiclesLower` are the resolved terminology words
 * (#496) — "car"/"cars" for the default install, whatever a race has
 * overridden them to otherwise. Both are needed, not just the plural: "1
 * cars" reads as broken English where "1 car" does not.
 */
export function excludedNotice(
  count: number,
  vehicleLower: string,
  vehiclesLower: string,
): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? vehicleLower : vehiclesLower;
  const verb = count === 1 ? 'is' : 'are';
  return `${count} ${noun} ${verb} racing but not ranked in these standings.`;
}
