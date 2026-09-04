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

    it('carries the QR code display view text (#614)', () => {
        const input = buildCreateRaceInput({
            ...baseFormData,
            qr_headline: 'Scan to Vote for Best in Show!',
            qr_wifi_note: 'Connect to Pack 123 Guest Wi-Fi',
        });

        expect(input.qrHeadline).toBe('Scan to Vote for Best in Show!');
        expect(input.qrWifiNote).toBe('Connect to Pack 123 Guest Wi-Fi');
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
            { name: 'Lion', color: '#F4D03F', division: 'Lion', carNumberRangeStart: 100, carNumberRangeEnd: 199 },
            { name: 'Bear', color: '#85C1E9', division: null, carNumberRangeStart: null, carNumberRangeEnd: null },
        ]);
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
            qrHeadline: undefined,
            qrWifiNote: undefined,
            // A plain form submission: no groups, and every word inherited.
            racingGroups: [],
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
