import { describe, expect, it } from 'vitest';
import { buildCreateRaceInput } from './raceInput';
import type { RaceFormData } from './components/RaceForm';

const baseFormData: RaceFormData = {
    name: 'Pack 42 Derby',
    date_time: '2026-03-14T10:00',
    location: 'Church Gym',
    track_id: 3,
    scoring_strategy: 'TIMED',
    tiebreaker: 'SHARED',
    drop_worst_runs: 0,
    car_numbering_strategy: 'GLOBAL',
    global_start_number: 1,
    championship_trophies: 3,
    weight_limit_oz: 5.0,
    master_running_order: false,
    exclude_round_winners_from_qualifying_standings: false,
    one_trophy_per_racer: false,
};

describe('buildCreateRaceInput', () => {
    it('carries the weight limit — the reported bug', () => {
        // Navigation.tsx's create-race handler built this object without
        // weightLimitOz, so a race created from "New Race…" got no weight
        // check while the form on screen showed one ticked (#332).
        expect(buildCreateRaceInput(baseFormData).weightLimitOz).toBe(5.0);
    });

    it('carries a cleared weight limit as null, not as dropped', () => {
        expect(
            buildCreateRaceInput({ ...baseFormData, weight_limit_oz: null }).weightLimitOz,
        ).toBeNull();
    });

    it('carries the tiebreaker method (#540)', () => {
        expect(buildCreateRaceInput({ ...baseFormData, tiebreaker: 'COUNTBACK' }).tiebreaker).toBe(
            'COUNTBACK',
        );
    });

    it('carries the drop-worst-runs modifier (#547)', () => {
        expect(
            buildCreateRaceInput({ ...baseFormData, drop_worst_runs: 1 }).dropWorstRuns,
        ).toBe(1);
    });

    it('never sends the QR code display view text (#945) — it is offered on the edit form only', () => {
        // `RaceForm`'s Displays section that sets these is edit-only, so
        // `data` never carries them on a real create submission — but even a
        // caller that sets them anyway must not see them reach `createRace`,
        // or the one mutation both forms build through could disagree with
        // what the screen sends.
        const input = buildCreateRaceInput({
            ...baseFormData,
            qr_headline: 'Scan to Vote for Best in Show!',
            qr_wifi_note: 'Connect to Pack 123 Guest Wi-Fi',
        });

        expect(input).not.toHaveProperty('qrHeadline');
        expect(input).not.toHaveProperty('qrWifiNote');
    });

    it('carries the racing groups the wizard scaffolded or copied (#662)', () => {
        const input = buildCreateRaceInput({
            ...baseFormData,
            racing_groups: [
                { name: 'Lion', color: '#F4D03F', division: 'Lion', car_number_range_start: 100, car_number_range_end: 199 },
                { name: 'Bear', color: '#85C1E9', division: '' },
            ],
        });

        expect(input.racingGroups).toEqual([
            { name: 'Lion', color: '#F4D03F', division: 'Lion', carNumberRangeStart: 100, carNumberRangeEnd: 199, copiedFromId: null },
            { name: 'Bear', color: '#85C1E9', division: null, carNumberRangeStart: null, carNumberRangeEnd: null, copiedFromId: null },
        ]);
    });

    it('carries award definitions copied from a previous race (#722), with no recipient field at all', () => {
        const input = buildCreateRaceInput({
            ...baseFormData,
            racing_groups: [],
            awards: [
                {
                    name: 'Fastest Overall',
                    kind: 'SPEED',
                    source: 'ALL',
                    place: 1,
                    from_bottom: false,
                    racing_group_id: null,
                    artwork_key: 'trophy',
                    sort_order: 0,
                    votable: false,
                    copied_from_round_id: null,
                },
            ],
        });

        expect(input.awards).toEqual([
            {
                name: 'Fastest Overall',
                kind: 'SPEED',
                source: 'ALL',
                place: 1,
                fromBottom: false,
                racingGroupId: null,
                artworkKey: 'trophy',
                sortOrder: 0,
                votable: false,
                copiedFromRoundId: null,
            },
        ]);
        expect(input.awards[0]).not.toHaveProperty('racerId');
    });

    it('sends an empty award list for a plain submission with no copy step', () => {
        expect(buildCreateRaceInput(baseFormData).awards).toEqual([]);
    });

    it('sends a null round plan for a plain submission with no copy step (#1088)', () => {
        expect(buildCreateRaceInput(baseFormData).roundPlan).toBeNull();
    });

    it('carries a copied round plan through to the camelCase createRace input', () => {
        const input = buildCreateRaceInput({
            ...baseFormData,
            racing_groups: [],
            round_plan: {
                generalRound: { type: 'ALL', schedulingStrategy: 'GENERAL', runsPerLane: 2 },
                championshipRounds: [
                    {
                        name: 'Finals',
                        source: 'ALL',
                        numTopRacers: 3,
                        runsPerLane: 1,
                        advancementFromBottom: false,
                        sourceRoundId: 9,
                    },
                ],
            },
        });

        expect(input.roundPlan).toEqual({
            generalRound: {
                type: 'ALL',
                schedulingStrategy: 'GENERAL',
                runsPerLane: 2,
                eliminationLosses: null,
                balancedPhases: null,
                // #1090, part D — carried through the same as every other
                // field on the general round; `null` here since the fixture
                // this plan comes from carries no `algorithm` of its own.
                algorithm: null,
            },
            championshipRounds: [
                {
                    name: 'Finals',
                    source: 'ALL',
                    numTopRacers: 3,
                    runsPerLane: 1,
                    advancementFromBottom: false,
                    sourceRoundId: 9,
                },
            ],
        });
    });

    it('sends null when a copy leaves "Copy the rounds too" unticked', () => {
        expect(buildCreateRaceInput({ ...baseFormData, round_plan: null }).roundPlan).toBeNull();
    });

    it('carries the words the wizard chose, and nulls where the race inherits (#662)', () => {
        const input = buildCreateRaceInput({
            ...baseFormData,
            vehicle_singular: 'Rocket',
            vehicle_plural: 'Rockets',
            vehicle_artwork_key: 'rocket',
            racing_group_singular: 'Den',
            racing_group_plural: 'Dens',
            organization_singular: 'Pack',
            organization_plural: 'Packs',
        });

        expect(input.vehicleSingular).toBe('Rocket');
        expect(input.vehicleArtworkKey).toBe('rocket');
        expect(buildCreateRaceInput(baseFormData).vehicleSingular).toBeNull();
    });

    it('maps every other field from snake_case to camelCase', () => {
        expect(buildCreateRaceInput(baseFormData)).toEqual({
            name: 'Pack 42 Derby',
            dateTime: '2026-03-14T10:00',
            location: 'Church Gym',
            trackId: 3,
            scoringStrategy: 'TIMED',
            tiebreaker: 'SHARED',
            dropWorstRuns: 0,
            carNumberingStrategy: 'GLOBAL',
            globalStartNumber: 1,
            championshipTrophies: 3,
            weightLimitOz: 5.0,
            // A plain form submission: no groups, no awards, no round plan,
            // and every word inherited.
            racingGroups: [],
            awards: [],
            roundPlan: null,
            racingGroupSingular: null,
            racingGroupPlural: null,
            organizationSingular: null,
            organizationPlural: null,
            vehicleSingular: null,
            vehiclePlural: null,
            vehicleArtworkKey: null,
        });
    });
});
