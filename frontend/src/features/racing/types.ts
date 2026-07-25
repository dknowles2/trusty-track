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
 * One lane within a heat's `laneResults` JSON blob.
 *
 * Not schema-derived: `laneResults` is a JSON string on the wire, so the
 * backend's GraphQL type says nothing about its contents. See #5 — once lanes
 * are normalised into a table this becomes a real generated type.
 */
export interface LaneResult {
  lane: number;
  racer_id: number | null;
  time: number | string | null;
  place: number | null;
  skipped?: boolean;
}
