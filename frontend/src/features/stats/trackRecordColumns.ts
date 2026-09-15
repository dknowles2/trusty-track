/** The one field `hideRaceColumn` reads off a track-record row. A subset of
 * `RaceStats.tsx`'s own `TrackRecord` interface, so this module takes no
 * dependency on it — the same "pure function over plain values" shape
 * `racingGroupLabel.ts`'s `shouldShowDivision` already uses. */
export interface RaceScopedRecord {
  raceId: number | null;
}

/**
 * Whether the Track Record table's own "Race" column is worth a column at
 * all (#1147).
 *
 * The table used to print a wide "Race" cell on every row — wrapping a name
 * like "2026 Pinewood Derby, Sep 19, 2026" across up to four lines — *and* a
 * "THIS EVENT" badge under the racer's own name, naming the same race
 * twice on the common case: a fresh event where every record on the list
 * was just set here. `RaceStats.tsx` drops the standalone column
 * unconditionally and instead prints the race name as one muted line under
 * the racer's name — but only when it says something the badge does not
 * already say. When every record belongs to the race on screen, the badge
 * (`tr.raceId === stats.raceId`) already names it on every row, so the
 * muted line would be pure repetition; this returns `true` and
 * `RaceStats.tsx` renders nothing extra. A list that mixes this race with
 * an earlier one (or a hand-entered historical record, `raceId: null`)
 * needs the race said somewhere, since the badge only appears on the rows
 * that match.
 *
 * An empty list has nothing to hide or show either way — `false`, matching
 * `every()`'s own vacuous-true default would otherwise (wrongly) collapse a
 * list with zero rows into "every row is this race."
 */
export function hideRaceColumn(records: RaceScopedRecord[], currentRaceId: number): boolean {
  return records.length > 0 && records.every((r) => r.raceId === currentRaceId);
}
