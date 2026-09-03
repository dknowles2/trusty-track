// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CarSticker from './CarSticker';
import type { PrintableRace, PrintableRacer, PrintableRacingGroup } from '../documents';

afterEach(cleanup);

const RACE: PrintableRace = { name: 'Pack 42 Derby' };

const RACING_GROUP: PrintableRacingGroup = { id: 5, name: 'Wolves', color: '#8b4513' };

const RACER: PrintableRacer = {
    id: 11,
    first_name: 'Alex',
    last_name: 'Rivera',
    car_number: 7,
    racing_group_id: 5,
    car_weight: 4.982,
};

describe('CarSticker', () => {
    it('prints the number, the name, the den and the weight', () => {
        render(<CarSticker racer={RACER} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
        expect(screen.getByText('Wolves')).toBeInTheDocument();
        // Two decimal places, not the four significant figures on file.
        expect(screen.getByText('4.98 oz')).toBeInTheDocument();
    });

    it('sends the name through the display-name formatter', () => {
        render(
            <CarSticker racer={RACER} race={RACE} racingGroup={RACING_GROUP} nameDisplay="LAST_INITIAL" />,
        );

        expect(screen.getByText('Alex R.')).toBeInTheDocument();
        expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    });

    it('leaves a blank line when there is no recorded weight', () => {
        const unweighed: PrintableRacer = { ...RACER, car_weight: undefined };
        render(<CarSticker racer={unweighed} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByText('____ oz')).toBeInTheDocument();
    });

    it('treats a recorded 0 the same as no weight at all', () => {
        // 0 is what an empty number input hands back, not a very light car —
        // the same rule `weightVerdict` uses for the roster's own check.
        const zero: PrintableRacer = { ...RACER, car_weight: 0 };
        render(<CarSticker racer={zero} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByText('____ oz')).toBeInTheDocument();
    });

    it('forces a blank weight line when printing before check-in, even with a weight on file', () => {
        render(
            <CarSticker racer={RACER} race={RACE} racingGroup={RACING_GROUP} printBeforeCheckIn />,
        );

        expect(screen.getByText('____ oz')).toBeInTheDocument();
        expect(screen.queryByText('4.98 oz')).not.toBeInTheDocument();
    });

    it('points the QR code at the check-in barcode endpoint', () => {
        render(<CarSticker racer={RACER} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByRole('img')).toHaveAttribute('src', '/api/printables/barcode/11.png');
    });

    it('prints a dash rather than nothing when the car has no number yet', () => {
        const unnumbered: PrintableRacer = { ...RACER, car_number: undefined };
        render(<CarSticker racer={unnumbered} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByText('—')).toBeInTheDocument();
    });
});
