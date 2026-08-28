import type { RaceFormData } from './components/RaceForm';

/**
 * Maps `RaceForm`'s snake_case fields to the camelCase `CreateRace` input
 * (#332).
 *
 * `Navigation.tsx` and `Home.tsx` each render the same `RaceForm` and each
 * used to build this object inline — and the nav bar's copy was missing
 * `weightLimitOz`, so a race created from "New Race…" silently dropped the
 * weight check the form on screen said was on. One builder, called from both
 * create-race handlers, is what keeps that from happening a second way.
 */
export function buildCreateRaceInput(data: RaceFormData) {
    return {
        name: data.name,
        dateTime: data.date_time,
        location: data.location,
        trackId: data.track_id,
        scoringStrategy: data.scoring_strategy,
        carNumberingStrategy: data.car_numbering_strategy,
        globalStartNumber: data.global_start_number,
        championshipTrophies: data.championship_trophies,
        weightLimitOz: data.weight_limit_oz,
    };
}
