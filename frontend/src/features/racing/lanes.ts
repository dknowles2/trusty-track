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
import type { Heat, Lane, LaneInput } from './types';

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

/**
 * Heats that were skipped and never re-run, in heat-number order (issue
 * #1001) — the earliest is the one an operator would want to run first.
 * `wasSkipped` already asks the per-heat question ("skipped, and nothing has
 * been timed since"); this lifts it to a list of heats for the Round
 * Complete!/Race Complete! summaries, both of which need to name *which*
 * heat rather than just whether one exists.
 */
export const skippedHeats = (heats: readonly Heat[]): Heat[] =>
  heats.filter((h) => wasSkipped(h.lanes)).sort((a, b) => a.heatNumber - b.heatNumber);

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
  const placeByLane = new Map<number, number>();
  let currentPlace = 1;
  for (let i = 0; i < finishers.length; i++) {
    if (i > 0 && finishers[i].time > finishers[i - 1].time) {
      currentPlace = i + 1;
    }
    placeByLane.set(finishers[i].lane, currentPlace);
  }

  return results.map((r) => ({
    ...r,
    skipped: false, // Always clear skipped flag if we have any time.
    place: placeByLane.get(r.lane) ?? null,
  }));
};

/**
 * A per-lane heat time, formatted for display (#763). Every screen that
 * shows a raw recorded time — RaceExecution's live lane cards,
 * ScheduleManagement's and RaceControl's schedule tables, FreeRaceExecution,
 * the projector and broadcast overlay, and the timer diagnostics page — had
 * its own `.toFixed()` call, three decimals on most of them and four on the
 * live-heat screens, with nothing saying why the fourth digit was there. It
 * was not a deliberate finer reading: it is one rule now, three decimals
 * everywhere, matching what every real timer profile's own precision
 * supports and what the standings score formatter
 * (`scoringStrategyText.formatScore`) already uses.
 *
 * `null`/`undefined` (nothing recorded yet) returns `null` rather than a
 * fallback string, since that varies by screen ("--", "—", blank); the
 * caller supplies its own with `formatLaneTime(time) ?? '—'`.
 *
 * A time at or below zero is the DNF marker this file's own `assignPlaces`
 * already reads, mirroring `backend/domain/scoring.py`: the timer assigns it
 * no place, and it scores as a penalty rather than a real result. Printing
 * "0.000s" — or, worse, a bare `9.999s` penalty value with nothing marking
 * it as one — is how an operator mistakes a scratch for a result; this
 * always prints "DNF" for a non-positive time instead of the number.
 */
export const formatLaneTime = (time: number | null | undefined): string | null => {
  if (time == null) {
    return null;
  }
  if (time <= 0) {
    return 'DNF';
  }
  return `${time.toFixed(3)}s`;
};

/**
 * Whether `scoringStrategy` scores from a recorded *time* rather than a
 * hand-entered *place* — the distinction the Override/Edit modal's column
 * choice turns on (#490), and the one thing #547's two new strategies have
 * to get right on the frontend.
 *
 * `POINTS` is the only place-based strategy today, so this is `!== 'POINTS'`
 * — but it is stated as its own predicate, not spelled out at each call
 * site, because every strategy #547 adds (`CUMULATIVE_TIME`,
 * `FASTEST_TIME`) is time-based and a future member that sums *placements*
 * the way `POINTS` does would need exactly one place updated rather than
 * every site that copied the "not `POINTS`" test agreeing with it by luck.
 * Mirrors `backend.domain.scoring`'s module docstring, which states the same
 * four strategies.
 */
export const isTimeBasedStrategy = (scoringStrategy: string | null | undefined): boolean =>
  scoringStrategy !== 'POINTS';

/**
 * Whether saving an official heat's edited results should run them through
 * {@link assignPlaces} (issue #490).
 *
 * Mirrors which column the Override/Edit modal requires: a `TIMED` race
 * enters times and always wants them turned into places — the rule
 * `FreeRaceExecution` already follows unconditionally, since free racing has
 * no place column to enter by hand. A `POINTS` race enters places directly,
 * with no time to derive them from — `assignPlaces` reads "no time anywhere"
 * as "clear every place", which is exactly backwards for a lane the operator
 * just placed by hand, so it must not run at all. The modal shows a Time
 * column for a `POINTS` race too (#525), so a stored or spurious time stays
 * correctable, but that column is optional there and must never drive
 * derivation the way it does for `TIMED`.
 *
 * Deciding this from the strategy rather than from the edited lanes' own
 * shape (e.g. "times present and places absent") matters for a *correction*:
 * re-editing an already-placed `TIMED` heat to fix one mistyped time must
 * still recompute every place from the new times, even though the old places
 * are sitting right there in the payload.
 */
export const shouldDerivePlaces = (scoringStrategy: string | null | undefined): boolean =>
  isTimeBasedStrategy(scoringStrategy);

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

/**
 * Real racers assigned a lane — an empty lane or an undecided championship
 * slot is not a competitor to place behind. Mirrors
 * `backend/domain/lanes.py`'s `real_racer_ids`.
 */
const realRacerCount = (results: readonly LaneInput[]): number =>
  results.filter((r) => r.racerId !== null).length;

/**
 * Lane numbers whose hand-entered place is not a positive number (issue
 * #766, extending #524's server-side rule to the client). `handleResultChange`
 * in `RaceExecution.tsx` already refuses to store one of these as the
 * operator types, so this mostly documents that the invariant holds rather
 * than catching anything live — but it is what makes {@link placeIssue} a
 * complete mirror of `crud.validate_lane_replacement` rather than an
 * incomplete one somebody has to remember not to trust. Mirrors
 * `backend/domain/lanes.py`'s `places_below_one`.
 */
export const placesBelowOne = (results: readonly LaneInput[]): number[] =>
  results.filter((r) => r.place != null && r.place < 1).map((r) => r.lane);

/**
 * Lane numbers whose place exceeds the number of real racers in the heat
 * (issue #766). Mirrors `backend/domain/lanes.py`'s `places_above_field` —
 * see there for why an empty field checks nothing.
 */
export const placesAboveField = (results: readonly LaneInput[]): number[] => {
  const field = realRacerCount(results);
  if (!field) return [];
  return results.filter((r) => r.place != null && r.place > field).map((r) => r.lane);
};

/**
 * Place values claimed by more than one lane, each named once (issue #766).
 * Mirrors `backend/domain/lanes.py`'s `duplicate_places`.
 *
 * A genuine tie in recorded times — multiple lanes sharing the identical
 * positive finish time — genuinely shares a place and is not flagged (#816).
 * Duplicate places without matching times are flagged.
 */
export const duplicatePlaces = (results: readonly LaneInput[]): number[] => {
  const byPlace = new Map<number, LaneInput[]>();
  for (const r of results) {
    if (r.place == null) continue;
    const group = byPlace.get(r.place) ?? [];
    group.push(r);
    byPlace.set(r.place, group);
  }

  const dupes: number[] = [];
  for (const [place, group] of byPlace.entries()) {
    if (group.length > 1) {
      const firstTime = group[0].time;
      const isGenuineTie =
        firstTime !== null &&
        firstTime !== undefined &&
        typeof firstTime === 'number' &&
        firstTime > 0 &&
        group.every((r) => r.time === firstTime);

      if (!isGenuineTie) {
        dupes.push(place);
      }
    }
  }
  return dupes;
};

/**
 * The first problem with a hand-entered set of places, or `null` if there
 * isn't one (issue #766).
 *
 * Mirrors `crud.validate_lane_replacement`'s own place checks — same order,
 * same wording — so the client catches what the server would refuse before
 * the operator ever clicks Save, and reads the identical sentence in the
 * rare case something still reaches the server unchecked (a stale prop, a
 * second tab). It is a *first* check, not a replacement one: the server
 * remains the backstop for anything this can't see, e.g. a lane set that
 * does not match the heat's own schedule.
 *
 * Deliberately does not check lane numbers themselves (duplicate or unknown
 * lanes) — those come from the heat's own stored schedule, never from
 * anything the operator types, so there is nothing here to mistype.
 */
export const placeIssue = (results: readonly LaneInput[]): string | null => {
  const belowOne = placesBelowOne(results);
  if (belowOne.length) return `Lane ${belowOne[0]}'s place must be 1 or higher.`;

  const aboveField = placesAboveField(results);
  if (aboveField.length) {
    const field = realRacerCount(results);
    return `Lane ${aboveField[0]}'s place is higher than the ${field} racer(s) in this heat.`;
  }

  const dupes = duplicatePlaces(results);
  if (dupes.length) return `Place ${dupes[0]} is assigned to more than one lane.`;

  return null;
};

/**
 * A typed time field as the number it will be saved as, or `null` for
 * blank or unparsable text — factored out of `RaceExecution.tsx`'s
 * `handleSaveResults` (issue #766) so the equal-time tie detector below
 * reads the exact value that will be saved, rather than a second copy of
 * the same parsing rule free to drift from it.
 */
export const parseTimeText = (timeText: string): number | null => {
  const time = Number(timeText);
  return timeText.trim() === '' || isNaN(time) ? null : time;
};

/**
 * How many lane columns a schedule table or heat sheet needs (issue #994).
 *
 * `track.laneCount` is usually enough, but a track is shared across seasons
 * (`.claude/rules/scheduling.md`): shrinking it after a race leaves that
 * race's finished heats naming a lane the track no longer has. #325 rewrites
 * *pending* heats to match a new lane count, deliberately not recorded
 * ones — the data is real and must not be discarded — so a screen that
 * renders exactly `laneCount` columns silently clips that lane's results off
 * the page, even though `heats { lanes { lane time } }` still holds them.
 *
 * The fix is not "read the heats instead of the track" — that would break
 * the rule this one extends: a heat short a lane (an outage, say) must still
 * line up with its neighbours, showing an empty column rather than shifting
 * left, which only works if every row has at least `laneCount` columns. So
 * this is a `max`: at least the track's own lanes, and at least whatever
 * lane number the given heats actually hold.
 *
 * One function for both callers (`ScheduleManagement.tsx`,
 * `HeatSheet.tsx`) so they cannot independently derive the column count and
 * disagree about it the way they did before this existed.
 */
export const laneColumnCount = (
  laneCount: number,
  heats: readonly { lanes: readonly { lane: number }[] }[],
): number =>
  heats.reduce(
    (max, heat) => heat.lanes.reduce((laneMax, l) => Math.max(laneMax, l.lane), max),
    laneCount,
  );

/**
 * Lanes that recorded the identical time, grouped by that time (issue
 * #766). `assignPlaces` breaks a genuine tie by array order with nothing on
 * screen to say a tie happened — two identical hand-typed times silently
 * become 2nd and 3rd. This does not change what gets saved: for a
 * `TIMED` race there is no Place column to correct it from, and rewriting
 * the times themselves is not this function's business. It exists so
 * `RaceExecution` can show the operator the tie exists, the same "computed,
 * never rewritten" shape {@link placeIssue} follows for the Place column.
 *
 * Mirrors `assignPlaces`'s own finisher filter — only a real time (`> 0`)
 * counts, so a DNF's `0` or a negative marker never reads as a three-way
 * tie with every other DNF in the heat.
 */
export const tiedTimeGroups = (
  results: readonly { lane: number; time: number | null }[],
): { time: number; lanes: number[] }[] => {
  const byTime = new Map<number, number[]>();
  for (const r of results) {
    if (r.time === null || r.time <= 0) continue;
    const group = byTime.get(r.time) ?? [];
    group.push(r.lane);
    byTime.set(r.time, group);
  }
  return [...byTime.entries()]
    .filter(([, lanes]) => lanes.length > 1)
    .map(([time, lanes]) => ({ time, lanes: [...lanes].sort((a, b) => a - b) }))
    .sort((a, b) => a.time - b.time);
};
