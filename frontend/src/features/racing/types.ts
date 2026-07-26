/**
 * Shared view types for the race-control screens.
 *
 * These are derived from the generated `GetRaceControlDataQuery` rather than
 * hand-written, so they are exactly the shape the query actually returns. They
 * previously existed as duplicate interface declarations in both
 * `pages/RaceControl.tsx` and `components/RaceExecution.tsx`, with nothing
 * connecting either copy to the schema.
 *
 * Regenerate with `npm run codegen` after changing the query or the backend
 * schema; a mismatch becomes a compile error rather than a runtime `undefined`.
 */
import type {
  GetRaceControlDataQuery,
  HeatLaneInput,
  HeatSessionSubscription,
} from '../../gql/operations';

type RaceControlRace = NonNullable<GetRaceControlDataQuery['race']>;

export type Heat = RaceControlRace['heats'][number] & {
  /** Present only when the query asks for it. */
  globalHeatNumber?: number;
};

export type Racer = RaceControlRace['racers'][number];

export type Round = RaceControlRace['rounds'][number];

export type AdvancementStatus = Round['advancementStatus'] & {
  /** Attached client-side when a round summary is raised. */
  roundId?: number;
};

export type AdvancementRacer = AdvancementStatus['advancingRacers'][number];

/**
 * One lane of a heat, as the backend now reports it (#5).
 *
 * Schema-derived, unlike the `laneResults` JSON blob it replaces — that was a
 * string on the wire, so the GraphQL type said nothing about its contents and
 * every screen re-declared its own guess at the shape.
 *
 * Three things it fixes:
 *
 * - `time` is a number. The blob sometimes held `"3.45"`, so every reader had
 *   to coerce, and the ones that forgot compared strings.
 * - An undecided championship slot is `placeholderSlot`, not a negative
 *   `racerId`. Readers no longer need to know that encoding to filter it out,
 *   and an empty lane is finally distinguishable from an unfilled one.
 * - `skipped` is a field rather than an untyped extra key.
 */
export type Lane = Heat['lanes'][number];

/**
 * One lane as the mutations take it.
 *
 * Schema-derived too, since #5 step 5 replaced the JSON string they used to
 * accept. Deliberately the same fields as {@link Lane} — what a screen reads is
 * what it sends back, with no encoding step in between.
 */
export type LaneInput = HeatLaneInput;

/**
 * The live view of a track, assembled by the server (#7).
 *
 * `HeatSession` is what the operator screen renders from. It replaces merging
 * the heat's stored lanes with `timerStatus.pendingResults` in a render
 * function — the most safety-critical rule in the app, recomputed on every
 * render, in the browser, untested.
 */
export type HeatSession = NonNullable<HeatSessionSubscription['heatSession']>;

/**
 * One lane of that view: {@link Lane} plus `pending`.
 *
 * `pending` says the time came from the timer and is not saved. An abort still
 * loses it, so the screen must not present it as final.
 */
export type LiveLane = HeatSession['lanes'][number];
