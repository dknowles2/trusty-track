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
import type { GetRaceControlDataQuery } from '../../gql/operations';

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
 * One lane as the *write* path still shapes it — the entries of the
 * `laneResults` JSON string that `updateHeatResult` accepts.
 *
 * Not schema-derived, because on the wire it is only a `String`. Read paths
 * should use {@link Lane}; this exists because mutations have not moved over
 * yet. It disappears in #5, step 5, when they take structured input.
 */
export interface LaneResult {
  lane: number;
  racer_id: number | null;
  time: number | string | null;
  place: number | null;
  skipped?: boolean;
}
