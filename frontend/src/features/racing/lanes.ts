/**
 * Predicates over a heat's lanes.
 *
 * These questions — has this heat run? was it skipped? — were asked in eight
 * places across the race-control screens, each with its own inline copy of the
 * test, and they had drifted: some counted a skipped heat as run and some did
 * not. Naming them makes the difference deliberate rather than accidental.
 *
 * Also the conversion to `HeatLaneInput` for the write path, which is a
 * near-identity — the read and write shapes match on purpose.
 */
import type { Lane, LaneInput } from './types';

/**
 * A lane with a recorded result — a time, or a hand-entered place.
 *
 * "Time" is the common case and the name predates the other one. A `POINTS`
 * race entered by hand through the Override/Edit modal — no timer, or a
 * timer that only reports finishing order (#490) — writes a place with no
 * time at all, and that is a result too. Mirrors `Lane.has_result` in
 * `backend/domain/lanes.py`: before the modal could enter a place on its
 * own, a lane never held one without a time, so broadening this changes
 * nothing for data recorded before #490.
 */
export const hasTime = (lane: Lane): boolean => lane.time !== null || lane.place !== null;

/** Any result recorded in this heat. */
export const hasTimes = (lanes: readonly Lane[]): boolean => lanes.some(hasTime);

/**
 * The heat is done with — raced, or passed over.
 *
 * The operator can skip a heat (everyone in it scratched, say), and for
 * "what's next" purposes that is as finished as one that ran. Note the backend
 * disagrees: `lanes.has_results` ignores `skipped`, so a skipped round can
 * still be regenerated.
 */
export const hasRun = (lanes: readonly Lane[]): boolean =>
  lanes.some((lane) => hasTime(lane) || lane.skipped);

/** Passed over rather than raced — skipped, and nothing was timed. */
export const wasSkipped = (lanes: readonly Lane[]): boolean =>
  lanes.some((lane) => lane.skipped) && !hasTimes(lanes);

/** Lanes in finishing order, unplaced last. */
export const byPlace = (lanes: readonly Lane[]): Lane[] =>
  [...lanes].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

/**
 * The racer in this lane, if it holds one.
 *
 * `null` covers both an empty lane and a championship slot whose racer has not
 * been decided yet — `placeholderSlot` tells those apart when it matters.
 */
export const racerIdIn = (lane: Lane): number | null => lane.racerId;

/**
 * A lane as the mutation takes it.
 *
 * Field-for-field the same as {@link Lane}, but spelt out rather than spread:
 * the cache attaches `__typename` to what it hands back, and GraphQL rejects an
 * input object carrying a field the type does not declare.
 */
export const toInput = (lane: Lane): LaneInput => ({
  lane: lane.lane,
  racerId: lane.racerId,
  placeholderSlot: lane.placeholderSlot,
  time: lane.time,
  place: lane.place,
  skipped: lane.skipped,
});

/** The same lanes with any result removed — what re-running a heat sends. */
export const cleared = (lanes: readonly Lane[]): LaneInput[] =>
  lanes.map((lane) => ({ ...toInput(lane), time: null, place: null, skipped: false }));

/**
 * Stamp finishing places over a heat's edited results.
 *
 * Mirrors `backend/domain/scoring.py`'s DNF rule: a recorded time of zero or
 * less is not a finish — the timer assigns it no place, and `POINTS` scores
 * it as a last-place penalty rather than as a placement (issue #308). Ranking
 * every recorded time, including a DNF's `0.0`, undid that: the DNF lane
 * sorted first and was stamped `place = 1`.
 *
 * Only lanes with a real time (`time > 0`) are ranked; a null, zero or
 * negative time gets `place: null`, same as an unrun lane.
 *
 * A heat with no recorded time at all (the operator hit Skip) clears every
 * place without touching `skipped` — this is not that heat's concern, since
 * the caller has already set `skipped` on the lanes it wants marked.
 */
export const assignPlaces = (results: readonly LaneInput[]): LaneInput[] => {
  const hasAnyTime = results.some((r) => r.time !== null);
  if (!hasAnyTime) {
    return results.map((r) => ({ ...r, place: null }));
  }

  const finishers = results
    .filter((r): r is LaneInput & { time: number } => typeof r.time === 'number' && r.time > 0)
    .sort((a, b) => a.time - b.time);
  const placeByLane = new Map(finishers.map((r, idx) => [r.lane, idx + 1]));

  return results.map((r) => ({
    ...r,
    skipped: false, // Always clear skipped flag if we have any time.
    place: placeByLane.get(r.lane) ?? null,
  }));
};

/**
 * Whether saving an official heat's edited results should run them through
 * {@link assignPlaces} (issue #490).
 *
 * Mirrors which column the Override/Edit modal shows: a `TIMED` race enters
 * times and always wants them turned into places — the rule `FreeRaceExecution`
 * already follows unconditionally, since free racing has no place column to
 * enter by hand. A `POINTS` race enters places directly, with no time to
 * derive them from — `assignPlaces` reads "no time anywhere" as "clear every
 * place", which is exactly backwards for a lane the operator just placed by
 * hand, so it must not run at all.
 *
 * Deciding this from the strategy rather than from the edited lanes' own
 * shape (e.g. "times present and places absent") matters for a *correction*:
 * re-editing an already-placed `TIMED` heat to fix one mistyped time must
 * still recompute every place from the new times, even though the old places
 * are sitting right there in the payload.
 */
export const shouldDerivePlaces = (scoringStrategy: string | null | undefined): boolean =>
  scoringStrategy !== 'POINTS';

/**
 * Whether saving a free-race heat's edited results should run them through
 * {@link assignPlaces} (issue #526).
 *
 * `shouldDerivePlaces` keys off the race's scoring strategy, which is the
 * wrong question here: a free heat is exhibition and is excluded from
 * scoring under either strategy (#6). What decides it is whether the
 * *track* has a timer (#490's `hasTimer`) — with one, the modal still only
 * takes times and always wants them turned into places; with none, the
 * modal takes a hand-typed finishing order directly, and `assignPlaces`
 * reading "no time anywhere" as "clear every place" would erase exactly
 * what the operator just typed.
 */
export const shouldDerivePlacesForFreeRace = (hasTimer: boolean): boolean => hasTimer;
