/**
 * `VehiclePicker` (#1250) — the swatch-button row that replaced the bare
 * `<select>` for `vehicle_artwork_key`, so the operator can see the picture
 * before choosing it. `terminologyGuard.test.ts` already checks this file
 * for a hardcoded "Car"/"Rocket"/"Boat" in JSX; this file checks the two
 * things that guard cannot: that the picture shown is genuinely
 * `VehicleGlyph`'s own line art, not a copy drawn here, and that the
 * selected option is exposed to assistive tech via `aria-pressed`.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLE_ARTWORK_OPTIONS } from '../terminologyDefaults';

vi.mock('../../printables/components/PrintDecor', () => ({
    VehicleGlyph: vi.fn(({ artworkKey }: { artworkKey: string | null | undefined }) => (
        <svg data-testid={`glyph-${artworkKey}`} />
    )),
}));

import { VehicleGlyph } from '../../printables/components/PrintDecor';
import VehiclePicker from './VehiclePicker';

describe('VehiclePicker', () => {
    it('renders one button per option, each showing the glyph and the label', () => {
        render(<VehiclePicker id="vehicle_artwork_key" value="car" onChange={vi.fn()} />);

        for (const option of VEHICLE_ARTWORK_OPTIONS) {
            const button = screen.getByTestId(`vehicle_artwork_key-option-${option.value}`);
            expect(button).toHaveTextContent(option.label);
            expect(button.querySelector('svg')).not.toBeNull();
        }
    });

    it('renders through VehicleGlyph itself, not a copy of its picture', () => {
        render(<VehiclePicker id="vehicle_artwork_key" value="car" onChange={vi.fn()} />);

        // Every option is drawn by calling the real `VehicleGlyph` — the
        // one place `.claude/rules/terminology-and-names.md`'s #551 stage 4
        // entry says a key becomes a picture. A component that drew its own
        // glyphs from a hardcoded map instead would never call this mock,
        // and this assertion would fail.
        // Called at least once per option — StrictMode's double-render in
        // the test environment means "at least", not "exactly".
        expect(vi.mocked(VehicleGlyph).mock.calls.length).toBeGreaterThanOrEqual(VEHICLE_ARTWORK_OPTIONS.length);
        const calledWith = vi.mocked(VehicleGlyph).mock.calls.map((call) => call[0]);
        for (const option of VEHICLE_ARTWORK_OPTIONS) {
            expect(calledWith).toContainEqual(expect.objectContaining({ artworkKey: option.value, size: 36 }));
        }
    });

    it('marks the selected option aria-pressed, and no other', () => {
        render(<VehiclePicker id="vehicle_artwork_key" value="rocket" onChange={vi.fn()} />);

        expect(screen.getByTestId('vehicle_artwork_key-option-rocket')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('vehicle_artwork_key-option-car')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('vehicle_artwork_key-option-boat')).toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onChange with the clicked key', async () => {
        const onChange = vi.fn();
        render(<VehiclePicker id="vehicle_artwork_key" value="car" onChange={onChange} />);

        await userEvent.click(screen.getByTestId('vehicle_artwork_key-option-boat'));

        expect(onChange).toHaveBeenCalledWith('boat');
    });

    it('is reachable from the label text, for the group as a whole', () => {
        render(<VehiclePicker id="vehicle_artwork_key" value="car" onChange={vi.fn()} />);

        expect(screen.getByLabelText('Vehicle picture')).toHaveAttribute('role', 'group');
    });

    it('accepts a caller-supplied label', () => {
        render(<VehiclePicker id="race-vehicle-artwork-key" value="car" onChange={vi.fn()} label="Vehicle picture (custom)" />);

        expect(screen.getByLabelText('Vehicle picture (custom)')).toHaveAttribute('role', 'group');
    });
});
