/**
 * The Roster page's page-header summary line (#949).
 *
 * The roster used to carry its own "Race Settings" card — a heading, an
 * Edit Details button, and a four-cell grid (Scoring, Numbering,
 * Championship Trophies, Track) — sitting above the table, read once by an
 * operator setting the race up and never again. On a tablet at the check-in
 * desk that card, plus the setup checklist above it, pushed the roster
 * table itself about 660px down an 800px screen. This is the fold: one
 * muted line under the page heading, replacing the grid.
 *
 * Pure, no React — the same split `setupChecklist.ts` and `raceFlow.ts`
 * make between the rule and the component that renders it. `strategyLabel`
 * and `numberingStrategyLabel` already exist for exactly this text and are
 * reused rather than restated; the group word comes from the caller's
 * resolved `useTerminology()`, never hardcoded, so the terminology guard
 * has nothing to flag here.
 */

import { strategyLabel } from '../stats/scoringStrategyText';
import { numberingStrategyLabel } from './raceSetup';

export interface RaceSummaryInput {
    scoring_strategy: string | null | undefined;
    car_numbering_strategy: string | null | undefined;
    championship_trophies: number | null | undefined;
    /** Resolved track name, or null when the race names no track / the track is unknown. */
    track_name: string | null | undefined;
}

/** Default from the create form (`RaceForm.tsx`) — mirrored here so a race
 *  saved before the field existed reads the same "3 trophies" it always
 *  awarded rather than "0 trophies" or a blank. */
const DEFAULT_CHAMPIONSHIP_TROPHIES = 3;

/**
 * "Timed (average) · Per Den · 3 trophies · Main Track" — the whole of what
 * the old grid said, in reading order rather than four labelled cells.
 */
export function raceSummaryLine(race: RaceSummaryInput, group: string): string {
    const trophies = race.championship_trophies ?? DEFAULT_CHAMPIONSHIP_TROPHIES;

    return [
        strategyLabel(race.scoring_strategy),
        numberingStrategyLabel(race.car_numbering_strategy, group),
        `${trophies} ${trophies === 1 ? 'trophy' : 'trophies'}`,
        race.track_name ?? 'Unknown',
    ].join(' · ');
}
