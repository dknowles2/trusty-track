import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hasVehicleArtwork, VEHICLE_ARTWORK_KEYS, VehicleGlyph } from './PrintDecor';

describe('hasVehicleArtwork', () => {
    it('recognises every key #551 stage 4 ships', () => {
        expect(hasVehicleArtwork('car')).toBe(true);
        expect(hasVehicleArtwork('rocket')).toBe(true);
        expect(hasVehicleArtwork('boat')).toBe(true);
    });

    it('rejects a key from a build that never shipped it — or none at all', () => {
        expect(hasVehicleArtwork('a-key-from-the-future')).toBe(false);
        expect(hasVehicleArtwork(null)).toBe(false);
        expect(hasVehicleArtwork(undefined)).toBe(false);
    });
});

describe('VehicleGlyph', () => {
    it('renders nothing for an unrecognised key, rather than a fallback car', () => {
        const { container } = render(<VehicleGlyph artworkKey="not-a-real-key" />);
        expect(container.querySelector('svg')).toBeNull();
    });

    it('renders nothing for a null or undefined key', () => {
        const { container: withNull } = render(<VehicleGlyph artworkKey={null} />);
        expect(withNull.querySelector('svg')).toBeNull();
        const { container: withUndefined } = render(<VehicleGlyph artworkKey={undefined} />);
        expect(withUndefined.querySelector('svg')).toBeNull();
    });

    it.each(VEHICLE_ARTWORK_KEYS)('draws a picture for "%s"', (key) => {
        const { container } = render(<VehicleGlyph artworkKey={key} />);
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('draws a different picture for each recognised key', () => {
        const drawings = VEHICLE_ARTWORK_KEYS.map((key) => {
            const { container } = render(<VehicleGlyph artworkKey={key} />);
            return container.querySelector('svg')!.innerHTML;
        });
        expect(new Set(drawings).size).toBe(drawings.length);
    });

    it('none of the vehicle glyphs carry role="img" — border furniture, not award artwork', () => {
        for (const key of VEHICLE_ARTWORK_KEYS) {
            const { container } = render(<VehicleGlyph artworkKey={key} />);
            expect(container.querySelector('svg[role="img"]')).toBeNull();
        }
    });

    it('defaults to --print-primary-color, not the App surface\'s --scouting-blue (#498)', () => {
        const { container } = render(<VehicleGlyph artworkKey="rocket" />);
        const svg = container.querySelector('svg')!;
        expect(svg.innerHTML).toContain('var(--print-primary-color');
        expect(svg.innerHTML).not.toContain('--scouting-blue');
    });

    it('a caller-supplied color wins over the default', () => {
        const { container } = render(<VehicleGlyph artworkKey="boat" color="red" />);
        const svg = container.querySelector('svg')!;
        expect(svg.innerHTML).toContain('red');
        expect(svg.innerHTML).not.toContain('var(--print-primary-color');
    });

    it('sizes off the same width prop for every vehicle, so a footer row does not reflow by key', () => {
        for (const key of VEHICLE_ARTWORK_KEYS) {
            const { container } = render(<VehicleGlyph artworkKey={key} size={54} />);
            const svg = container.querySelector('svg')!;
            expect(svg.getAttribute('width')).toBe('54');
        }
    });
});
