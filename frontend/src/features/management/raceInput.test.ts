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
    car_numbering_strategy: 'GLOBAL',
    global_start_number: 1,
    championship_trophies: 3,
    weight_limit_oz: 5.0,
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

    it('maps every other field from snake_case to camelCase', () => {
        expect(buildCreateRaceInput(baseFormData)).toEqual({
            name: 'Pack 42 Derby',
            dateTime: '2026-03-14T10:00',
            location: 'Church Gym',
            trackId: 3,
            scoringStrategy: 'TIMED',
            tiebreaker: 'SHARED',
            carNumberingStrategy: 'GLOBAL',
            globalStartNumber: 1,
            championshipTrophies: 3,
            weightLimitOz: 5.0,
        });
    });
});
