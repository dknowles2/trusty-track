/**
 * The three small mockups under the Appearance section's pickers (#498).
 *
 * Display and Printables are otherwise invisible until the operator walks to
 * a wall screen or hits print — this preview is the only way to answer "what
 * will the gym actually see" before committing. Built from the real
 * component markup (the actual classes every screen renders with, and the
 * actual `PitPass` component for Printables), scaled down, rather than a
 * separate illustration that could drift from what the app does.
 *
 * Nothing here is applied to `localStorage` or sent to the server — the
 * three panels are wrapped in the *candidate* theme's own `data-theme` and
 * tokens, purely as inline styles on this component's own subtree, and
 * update on every selection change.
 */

import { resolveDisplayTheme, resolvePrintablesTheme } from '../../../theming/applyTheme';
import { themeByKey, type SurfaceThemeSetting, type ThemeKey } from '../../../theming/themes';
import PitPass from '../../printables/components/PitPass';
import '../../printables/PrintSheet.css';

interface Props {
  appThemeKey: ThemeKey;
  displaySetting: SurfaceThemeSetting;
  printablesSetting: SurfaceThemeSetting;
}

const SAMPLE_RACER = {
  id: 1,
  first_name: 'Ada',
  last_name: 'Lovelace',
  car_number: 7,
};

const SAMPLE_RACER_2 = {
  id: 2,
  first_name: 'Grace',
  last_name: 'Hopper',
  car_number: 12,
};

const SAMPLE_RACE = { name: 'Pack 123 Derby' };

export default function AppearancePreview({
  appThemeKey,
  displaySetting,
  printablesSetting,
}: Props) {
  const appTheme = themeByKey(appThemeKey).app;
  const { key: displayKey, theme: displayTheme } = resolveDisplayTheme(
    displaySetting,
    appThemeKey,
  );
  const { key: printablesKey, theme: printablesTheme } = resolvePrintablesTheme(
    printablesSetting,
    appThemeKey,
  );

  return (
    <div
      className="appearance-preview"
      data-testid="appearance-preview"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}
    >
      {/* App */}
      <div
        data-theme={appThemeKey}
        data-testid="appearance-preview-app"
        style={{
          ...(appTheme.tokens as React.CSSProperties),
          background: 'var(--background-color)',
          color: 'var(--text-color)',
          fontFamily: 'var(--font-body)',
          padding: '0.75rem',
          borderRadius: 'var(--border-radius)',
          border: '1px solid var(--border-color)',
        }}
      >
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          App
        </p>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Race Control</h3>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
          {/* Not `disabled` — index.css's disabled state is a fixed grey
              regardless of theme, which would make this half of the preview
              always look the same. These have no click handler, so a real
              click does nothing anyway. */}
          <button type="button" className="primary-btn" tabIndex={-1} style={{ padding: '4px 10px', fontSize: '0.75rem', pointerEvents: 'none' }}>
            Record
          </button>
          <button type="button" className="secondary-btn" tabIndex={-1} style={{ padding: '4px 10px', fontSize: '0.75rem', pointerEvents: 'none' }}>
            Skip
          </button>
        </div>
        <div
          className="racer-card"
          style={{
            background: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius)',
            padding: '0.5rem',
            fontSize: '0.8rem',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>{SAMPLE_RACER.first_name} {SAMPLE_RACER.last_name}</div>
          <div style={{ color: 'var(--text-muted-color)' }}>Car #{SAMPLE_RACER.car_number}</div>
        </div>
      </div>

      {/* Display */}
      <div
        data-theme={displayKey}
        data-testid="appearance-preview-display"
        style={{
          ...(displayTheme.tokens as React.CSSProperties),
          background: 'var(--display-bg-color)',
          color: 'var(--display-text-color)',
          fontFamily: 'var(--font-body)',
          padding: '0.75rem',
          borderRadius: 'var(--border-radius)',
        }}
      >
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--display-accent-color)' }}>
          Display
        </p>
        <div
          className="heat-card"
          style={{
            background: 'var(--display-surface-color)',
            color: 'var(--display-text-color)',
            borderRadius: '6px',
            padding: '0.5rem',
            marginBottom: '0.5rem',
            fontSize: '0.75rem',
          }}
        >
          <div className="heat-card-title" style={{ fontWeight: 'bold', marginBottom: '0.3rem' }}>Now Racing</div>
          {[SAMPLE_RACER, SAMPLE_RACER_2].map((racer) => (
            <div key={racer.id} className="heat-card-racer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="heat-card-racer-name">{racer.first_name}</span>
              <span className="heat-card-car-number" style={{ color: 'var(--display-text-muted-color)' }}>#{racer.car_number}</span>
            </div>
          ))}
        </div>
        <table className="standings-table" style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
          {/* Matches Observation.tsx's own thead: a fixed dark text colour
              on the accent fill, not inherited white — the accent is a
              bright fill in every theme here, so white-on-accent is the
              same contrast trap Clear Sight's own design notes reject. */}
          <thead style={{ background: 'var(--display-accent-color)', color: 'var(--text-color)' }}>
            <tr>
              <th style={{ padding: '2px 4px', textAlign: 'left' }}>Rank</th>
              <th style={{ padding: '2px 4px', textAlign: 'left' }}>Racer</th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Printables */}
      <div
        data-theme={printablesKey}
        data-testid="appearance-preview-printables"
        style={{
          ...(printablesTheme.tokens as React.CSSProperties),
          background: 'var(--preview-border-color)',
          padding: '0.75rem',
          borderRadius: 'var(--border-radius, 12px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <p style={{ margin: '0 0 0.5rem', alignSelf: 'flex-start', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-color)' }}>
          Printables
        </p>
        <div
          style={{
            transform: 'scale(0.8)',
            transformOrigin: 'top center',
            // The real card geometry, from documents.ts's pit-pass spec —
            // PitPass.tsx's own CSS reads these two custom properties.
            ['--card-w' as string]: '3.5in',
            ['--card-h' as string]: '3.25in',
          }}
        >
          <PitPass racer={SAMPLE_RACER} race={SAMPLE_RACE} />
        </div>
      </div>
    </div>
  );
}
