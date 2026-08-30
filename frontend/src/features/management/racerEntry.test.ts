import { describe, expect, it } from 'vitest';
import { carryOver } from './racerEntry';
import type { RacerData } from './components/RacerForm';

const saved: RacerData = {
    first_name: 'Ada',
    last_name: 'Ant',
    car_number: 12,
    racing_group_id: 3,
    car_name: 'Blue Streak',
    car_weight: 4.9,
    car_passed_inspection: true,
    racer_image_url: '/static/ada.png',
    car_image_url: '/static/car.png',
    excluded_from_standings: true,
};

describe('carryOver', () => {
    it('keeps the racingGroup, because rosters are entered racingGroup by racingGroup', () => {
        expect(carryOver(saved).racing_group_id).toBe(3);
    });

    it('clears the names', () => {
        expect(carryOver(saved).first_name).toBe('');
        expect(carryOver(saved).last_name).toBe('');
    });

    it('does not increment the car number', () => {
        // Under MANUAL numbering — the only strategy where the operator types
        // one — a hand-numbered pack's next car is not reliably the last plus
        // one, and a wrong number that looks deliberate is worse than a blank.
        expect(carryOver(saved).car_number).toBeUndefined();
    });

    it('does not leave inspection switched on', () => {
        // Adding a racer to the roster is not the same act as inspecting their
        // car; a stuck toggle would check in children who are not there yet.
        expect(carryOver(saved).car_passed_inspection).toBe(false);
    });

    it('does not leave "racing, not ranked" switched on', () => {
        // A judgment about this one car, not a batch property like the racing
        // group — a stuck toggle would flag every racer typed in afterward.
        expect(carryOver(saved).excluded_from_standings).toBe(false);
    });

    it('drops the photographs', () => {
        const next = carryOver(saved);

        expect(next.racer_image_url).toBeUndefined();
        expect(next.car_image_url).toBeUndefined();
    });

    it('drops the car name and weight', () => {
        const next = carryOver(saved);

        expect(next.car_name).toBe('');
        expect(next.car_weight).toBeUndefined();
    });

    it('survives a racer who was in no racingGroup', () => {
        expect(carryOver({ ...saved, racing_group_id: undefined }).racing_group_id).toBeUndefined();
    });
});
