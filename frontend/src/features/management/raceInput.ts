import type { RaceFormData } from './components/RaceForm';
import { toRacingGroupInput, type RacingGroupDraft } from './raceSetup';

/**
 * Everything the setup wizard hands a create-race handler (#662): the form's
 * own fields, plus the racing groups scaffolded or copied on the way to it.
 */
export type RaceSetupData = RaceFormData & { racing_groups: readonly RacingGroupDraft[] };

/**
 * Maps `RaceForm`'s snake_case fields to the camelCase `CreateRace` input
 * (#332).
 *
 * `Navigation.tsx` and `Home.tsx` each render the same `RaceForm` and each
 * used to build this object inline — and the nav bar's copy was missing
 * `weightLimitOz`, so a race created from "New Race…" silently dropped the
 * weight check the form on screen said was on. One builder, called from both
 * create-race handlers, is what keeps that from happening a second way.
 *
 * The racing groups and the seven terminology fields ride along since #662:
 * `createRace` takes both, so the wizard's answers land in one mutation with
 * the race rather than N follow-up round trips. A plain `RaceForm` submission
 * with no groups and no words sends an empty list and nulls — exactly what
 * the server defaulted to before either field existed.
 */
export function buildCreateRaceInput(data: RaceFormData | RaceSetupData) {
    const racingGroups = 'racing_groups' in data ? data.racing_groups : [];
    return {
        name: data.name,
        dateTime: data.date_time,
        location: data.location,
        trackId: data.track_id,
        scoringStrategy: data.scoring_strategy,
        tiebreaker: data.tiebreaker,
        dropWorstRuns: data.drop_worst_runs,
        carNumberingStrategy: data.car_numbering_strategy,
        globalStartNumber: data.global_start_number,
        championshipTrophies: data.championship_trophies,
        weightLimitOz: data.weight_limit_oz,
        qrHeadline: data.qr_headline,
        qrWifiNote: data.qr_wifi_note,
        racingGroups: racingGroups.map(toRacingGroupInput),
        racingGroupSingular: data.racing_group_singular ?? null,
        racingGroupPlural: data.racing_group_plural ?? null,
        organizationSingular: data.organization_singular ?? null,
        organizationPlural: data.organization_plural ?? null,
        vehicleSingular: data.vehicle_singular ?? null,
        vehiclePlural: data.vehicle_plural ?? null,
        vehicleArtworkKey: data.vehicle_artwork_key ?? null,
    };
}
