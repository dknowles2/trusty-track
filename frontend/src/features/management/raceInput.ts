import type { RaceFormData } from './components/RaceForm';
import {
    toAwardCopyInput,
    toRacingGroupInput,
    toWizardConfigurationInput,
    type AwardCopyDraft,
    type RacingGroupDraft,
    type SourceRoundPlan,
} from './raceSetup';

/**
 * Everything the setup wizard hands a create-race handler (#662, #722,
 * #1088): the form's own fields, the racing groups scaffolded or copied on
 * the way to it, any award definitions carried over from a previous race,
 * and a copied round plan. `awards` and `round_plan` are optional because a
 * scratch setup has neither to send — `raceSetup.copyableAwards` returns an
 * empty list rather than `awards` being absent, but a plain `RaceForm`
 * submission with no wizard at all has no such fields either, and a copy
 * whose "Copy the rounds too" checkbox is unticked sends `round_plan: null`
 * explicitly rather than omitting the field.
 */
export type RaceSetupData = RaceFormData & {
    racing_groups: readonly RacingGroupDraft[];
    awards?: readonly AwardCopyDraft[];
    round_plan?: SourceRoundPlan | null;
};

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
 * The racing groups and the seven terminology fields ride along since #662,
 * and award definitions since #722: `createRace` takes all three, so the
 * wizard's answers land in one mutation with the race rather than N
 * follow-up round trips. A plain `RaceForm` submission with no groups, no
 * awards and no words sends empty lists and nulls — exactly what the server
 * defaulted to before any of those fields existed.
 *
 * `qrHeadline`/`qrWifiNote` are deliberately absent (#945) even though
 * `createRace` still accepts both — `RaceForm`'s Displays section that sets
 * them is edit-only, so there is nothing on `data` to send here; leaving
 * these two out is the same shape as `masterRunningOrder` and the other
 * update-only fields never appearing in this object at all.
 */
export function buildCreateRaceInput(data: RaceFormData | RaceSetupData) {
    const racingGroups = 'racing_groups' in data ? data.racing_groups : [];
    const awards = 'awards' in data && data.awards ? data.awards : [];
    const roundPlan = 'round_plan' in data && data.round_plan ? data.round_plan : null;
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
        racingGroups: racingGroups.map(toRacingGroupInput),
        awards: awards.map(toAwardCopyInput),
        roundPlan: roundPlan ? toWizardConfigurationInput(roundPlan) : null,
        racingGroupSingular: data.racing_group_singular ?? null,
        racingGroupPlural: data.racing_group_plural ?? null,
        organizationSingular: data.organization_singular ?? null,
        organizationPlural: data.organization_plural ?? null,
        vehicleSingular: data.vehicle_singular ?? null,
        vehiclePlural: data.vehicle_plural ?? null,
        vehicleArtworkKey: data.vehicle_artwork_key ?? null,
    };
}
