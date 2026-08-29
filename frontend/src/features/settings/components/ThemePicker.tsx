/**
 * One of the Appearance section's three pickers (#498): a labelled row of
 * theme swatches rather than a bare `<select>`, since "what does Old Glory
 * look like" is exactly the question a name alone cannot answer.
 *
 * The Display and Printables pickers include an explicit "Match App theme"
 * option, shown first — the App picker never does, since the App surface has
 * nothing to match.
 */

import { THEMES, type PickerSurface, type ThemeKey } from '../../../theming/themes';

export type { PickerSurface };

interface Props {
  id: string;
  label: string;
  blurb: string;
  surface: PickerSurface;
  /** A `ThemeKey`, or `'MATCH_APP'` when `includeMatchApp` is set. */
  value: string;
  onChange: (value: string) => void;
  includeMatchApp: boolean;
}

function swatchGradient(surface: PickerSurface, key: ThemeKey): string {
  const theme = THEMES.find((t) => t.key === key)!;
  const { primary, accent } =
    surface === 'app'
      ? { primary: theme.app.tokens['--scouting-blue'], accent: theme.app.tokens['--cub-scouting-gold'] }
      : surface === 'display'
        ? { primary: theme.display.tokens['--display-bg-color'], accent: theme.display.tokens['--display-accent-color'] }
        : { primary: theme.printables.tokens['--print-primary-color'], accent: theme.printables.tokens['--print-accent-color'] };
  return `linear-gradient(135deg, ${primary} 0%, ${primary} 50%, ${accent} 50%, ${accent} 100%)`;
}

export default function ThemePicker({ id, label, blurb, surface, value, onChange, includeMatchApp }: Props) {
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <p id={`${id}-label`} style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>
        {label}
      </p>
      <p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{blurb}</p>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}
      >
        {includeMatchApp && (
          <button
            type="button"
            data-testid={`${id}-option-MATCH_APP`}
            aria-pressed={value === 'MATCH_APP'}
            onClick={() => onChange('MATCH_APP')}
            className="theme-swatch-btn"
            title="Use whichever theme the App picker above is set to"
          >
            <span className="theme-swatch theme-swatch-match-app" aria-hidden="true">
              ↳
            </span>
            <span>Match App theme</span>
          </button>
        )}
        {THEMES.map((theme) => (
          <button
            key={theme.key}
            type="button"
            data-testid={`${id}-option-${theme.key}`}
            aria-pressed={value === theme.key}
            onClick={() => onChange(theme.key)}
            className="theme-swatch-btn"
            title={theme.description}
          >
            <span
              className="theme-swatch"
              aria-hidden="true"
              style={{ background: swatchGradient(surface, theme.key) }}
            />
            <span>{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
