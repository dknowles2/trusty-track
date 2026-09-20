/**
 * The Vehicle picture control (#1250) — a row of swatch buttons, each
 * showing the actual `VehicleGlyph` line art beside its name, in place of
 * the old bare `<select>` a native `<option>` could never draw a picture
 * inside. Same shape as `ThemePicker` (`theme-swatch-btn` buttons,
 * `aria-pressed` for the selected one, `data-testid="{id}-option-{key}"`),
 * reused rather than reinvented so the two pickers that sit on the same
 * settings page and the same race form behave alike.
 *
 * Renders `VehicleGlyph` (`features/printables/components/PrintDecor.tsx`)
 * rather than drawing its own picture — that stays the one place a key
 * becomes a picture (`.claude/rules/terminology-and-names.md`'s #551 stage
 * 4 entry), and a fourth vehicle still only needs adding to
 * `terminologyDefaults.ts`'s `VEHICLE_ARTWORK_OPTIONS` and to `VehicleGlyph`
 * itself — nothing here has its own copy of the vocabulary.
 *
 * No `inheritOption` unlike `ThemePicker`'s race-form use: the race form's
 * "Use different words for this race" checkbox already gates the whole
 * Words and names override block (`RaceForm.tsx`), so by the time this
 * picker is on screen a value is always in play — there is no third,
 * "inherit" state for it to express the way a race's theme override needs
 * one.
 */

import { VehicleGlyph } from '../../printables/components/PrintDecor';
import { VEHICLE_ARTWORK_OPTIONS } from '../terminologyDefaults';

interface Props {
    id: string;
    value: string;
    onChange: (key: string) => void;
    label?: string;
}

export default function VehiclePicker({ id, value, onChange, label = 'Vehicle picture' }: Props) {
    return (
        <div>
            <p id={`${id}-label`} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                {label}
            </p>
            <div
                role="group"
                aria-labelledby={`${id}-label`}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}
            >
                {VEHICLE_ARTWORK_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        data-testid={`${id}-option-${option.value}`}
                        aria-pressed={value === option.value}
                        onClick={() => onChange(option.value)}
                        className="theme-swatch-btn"
                    >
                        <span className="vehicle-swatch">
                            {/* 36px: inside the 26–54px range the glyphs were
                                drawn to be legible at (a pit pass footer, a
                                masthead mark) — aria-hidden already, on the
                                svg itself, inside VehicleGlyph. */}
                            <VehicleGlyph artworkKey={option.value} size={36} />
                        </span>
                        <span>{option.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
