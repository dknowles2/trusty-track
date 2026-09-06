// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import PitPass from './PitPass';
import type { PrintableRace, PrintableRacer, PrintableRacingGroup } from '../documents';

afterEach(cleanup);

const RACE: PrintableRace = {
    name: 'Pack 42 Derby',
    dateTime: '2026-03-14T09:30:00',
    location: "St Anne's Hall",
};

const RACING_GROUP: PrintableRacingGroup = {
    id: 5,
    name: 'Wolves',
    color: '#8b4513',
};

const RACER_NO_PHOTO: PrintableRacer = {
    id: 12,
    first_name: 'Sam',
    last_name: 'Okafor',
    car_number: 3,
};

const RACER_WITH_PHOTO: PrintableRacer = {
    id: 11,
    first_name: 'Alex',
    last_name: 'Rivera',
    car_number: 7,
    racing_group_id: 5,
    racer_image_url: '/static/alex.png',
};

describe('PitPass', () => {
    it('renders initials in a placeholder for a racer without a photo', () => {
        render(<PitPass racer={RACER_NO_PHOTO} race={RACE} />);

        // No image should be rendered.
        expect(screen.queryByRole('img')).not.toBeInTheDocument();

        // Initials should be rendered inside the photo placeholder.
        const initialsElement = screen.getByText('SO');
        expect(initialsElement).toBeInTheDocument();
        expect(initialsElement).toHaveClass('print-photo-placeholder');

        // It must be placed inside the portrait circle container.
        const portraitWrap = initialsElement.closest('.pit-pass-portrait');
        expect(portraitWrap).not.toBeNull();
    });

    it('renders the photo img element when a photo URL is present', () => {
        render(<PitPass racer={RACER_WITH_PHOTO} race={RACE} racingGroup={RACING_GROUP} />);

        const img = screen.getByRole('img');
        expect(img).toBeInTheDocument();
        expect(img).toHaveClass('print-photo');
        expect(img).toHaveAttribute('src', '/static/alex.png');
        expect(img).toHaveAttribute('alt', 'Alex Rivera');

        // Initials placeholder should not be rendered.
        expect(screen.queryByText('AR')).not.toBeInTheDocument();
        expect(document.querySelector('.print-photo-placeholder')).toBeNull();
    });

    it('renders racer details, group chip, and race information', () => {
        render(<PitPass racer={RACER_WITH_PHOTO} race={RACE} racingGroup={RACING_GROUP} />);

        expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
        expect(screen.getByText('Wolves')).toBeInTheDocument();
        expect(screen.getByText('RACER')).toBeInTheDocument();
        expect(screen.getByText('PIT PASS')).toBeInTheDocument();
        expect(screen.getByText("Pack 42 Derby / St Anne's Hall")).toBeInTheDocument();
        expect(screen.getByText('2026')).toBeInTheDocument();
    });

    it('formats the name according to nameDisplay', () => {
        render(
            <PitPass
                racer={RACER_WITH_PHOTO}
                race={RACE}
                racingGroup={RACING_GROUP}
                nameDisplay="FIRST_ONLY"
            />,
        );

        expect(screen.getByText('Alex')).toBeInTheDocument();
        expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    });

    it('PrintSheet.css retains flex centering on .pit-pass .print-photo-placeholder and does not apply display: block', () => {
        const cssPath = path.resolve(__dirname, '../PrintSheet.css');
        const css = fs.readFileSync(cssPath, 'utf-8');

        // Verify that any rule mentioning .pit-pass and .print-photo-placeholder does NOT set display: block
        const placeholderRules = Array.from(
            css.matchAll(/(?:^|\})\s*([^{]*\.pit-pass[^{]*\.print-photo-placeholder[^{]*)\{([^}]+)\}/g),
        );
        expect(placeholderRules.length).toBeGreaterThan(0);
        for (const [, , body] of placeholderRules) {
            expect(body).not.toMatch(/display:\s*block/);
        }

        // Verify the dedicated placeholder rule has flex centering: display: flex, align-items: center, justify-content: center
        const specificPlaceholderMatch = css.match(
            /(?:^|\})\s*\.pit-pass\s+\.print-photo-placeholder\s*\{([^}]+)\}/,
        );
        expect(specificPlaceholderMatch).not.toBeNull();
        const placeholderBody = specificPlaceholderMatch![1];
        expect(placeholderBody).toMatch(/display:\s*flex;/);
        expect(placeholderBody).toMatch(/align-items:\s*center;/);
        expect(placeholderBody).toMatch(/justify-content:\s*center;/);

        // Verify img rule has display: block and object-fit: cover separated from placeholder
        const photoMatch = css.match(/(?:^|\})\s*\.pit-pass\s+\.print-photo\s*\{([^}]+)\}/);
        expect(photoMatch).not.toBeNull();
        const photoBody = photoMatch![1];
        expect(photoBody).toMatch(/display:\s*block;/);
        expect(photoBody).toMatch(/object-fit:\s*cover;/);
    });
});
