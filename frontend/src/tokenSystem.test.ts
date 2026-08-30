import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_TOKEN_NAMES, DISPLAY_TOKEN_NAMES } from './theming/themes';

/**
 * Regression guard for #439 — the award/voting pages had grown their own
 * colours and field styles beside the token system in `index.css`. Each
 * check here pins one of the three duplications the issue found so a fresh
 * one does not creep back in silently the way the first three did.
 */

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');
}

const ERROR_RED_FILES = [
  'features/awards/pages/Awards.tsx',
  'features/awards/pages/VotingBallot.tsx',
  'features/settings/components/PinFieldRow.tsx',
  'features/observation/components/DisplaysPanel.tsx',
  'features/awards/artwork.tsx',
];

const FORM_FILES = [
  'features/awards/components/AwardForm.tsx',
  'features/settings/components/TrackRecords.tsx',
  'features/management/components/RaceForm.tsx',
  'features/racing/components/RoundWizard.tsx',
  'features/racing/components/RoundConfigModal.tsx',
];

describe('index.css tokens (#439)', () => {
  it('still defines the one --error red these files rely on', () => {
    expect(read('index.css')).toMatch(/--error:\s*#d32f2f/i);
  });

  it('still defines the shared .form-control field style', () => {
    const css = read('index.css');
    expect(css).toMatch(/\.form-control\s*\{[^}]*border[^}]*\}/is);
  });
});

describe('award/voting pages read the --error token, not their own red (#439)', () => {
  for (const file of ERROR_RED_FILES) {
    it(`${file} does not hardcode the old #b60205`, () => {
      expect(read(file)).not.toMatch(/#b60205/i);
    });
  }
});

describe('the voting-open and vote-confirmed banners share one StatusBanner (#439)', () => {
  it('Awards no longer invents its own voting-banner background', () => {
    expect(read('features/awards/pages/Awards.tsx')).not.toMatch(/#fffbea|#fafafa/i);
  });

  it('VotingBallot no longer invents its own confirmation-banner palette', () => {
    expect(read('features/awards/pages/VotingBallot.tsx')).not.toMatch(/#f0f9f0|#256029/i);
  });

  it('both pages render through the shared component', () => {
    expect(read('features/awards/pages/Awards.tsx')).toMatch(/StatusBanner/);
    expect(read('features/awards/pages/VotingBallot.tsx')).toMatch(/StatusBanner/);
  });

  it('StatusBanner is the one place the two tones are defined', () => {
    const banner = read('components/ui/StatusBanner.tsx');
    expect(banner).toMatch(/var\(--banner-active-bg-color\)/);
    expect(banner).toMatch(/var\(--banner-success-bg-color\)/);
  });
});

describe('the five hand-rolled forms share one field style (#439)', () => {
  for (const file of FORM_FILES) {
    it(`${file} uses the shared .form-control class`, () => {
      expect(read(file)).toMatch(/className="form-control"/);
    });

    it(`${file} does not redefine the field's border, padding or radius`, () => {
      const content = read(file);
      const inputStyleBlock = content.match(/const inputStyle[\s\S]*?=\s*\{[\s\S]*?\n\s*\};?/);
      // Some forms (RaceForm) keep a small `inputStyle` object purely for
      // layout (margin) once the field's shape moved to `.form-control` —
      // that is fine. What must not reappear is the shape itself.
      if (inputStyleBlock) {
        expect(inputStyleBlock[0]).not.toMatch(/border|padding|borderRadius/);
      }
    });
  }
});

/**
 * Regression guard for #498's groundwork — "Themes: three configurable
 * surfaces". Before a second Display or Printables theme can mean anything,
 * the files in those two surfaces have to stop reading `--scouting-blue` /
 * `--cub-scouting-gold` (the App surface's own tokens) directly and read
 * their own surface's tokens instead — otherwise picking a different
 * Printables theme while keeping the default App theme silently does
 * nothing, which is exactly the trap the issue calls out. Each check below
 * pins one file the groundwork PR moved; a fresh direct read creeping back
 * in is the same failure the #439 guards above exist to catch.
 */

const PRINTABLES_SURFACE_FILES = [
  'features/printables/PrintSheet.css',
  'features/printables/components/PrintDecor.tsx',
  'features/printables/pages/Certificate.tsx',
  'features/printables/pages/Printables.tsx',
  'features/printables/pages/HeatSheet.tsx',
  'features/printables/pages/ResultsSheet.tsx',
];

describe('the Printables surface reads its own tokens, not the App surface\'s (#498)', () => {
  for (const file of PRINTABLES_SURFACE_FILES) {
    it(`${file} does not read --scouting-blue or --cub-scouting-gold directly`, () => {
      const content = read(file);
      expect(content).not.toMatch(/var\(--scouting-blue/);
      expect(content).not.toMatch(/var\(--cub-scouting-gold/);
    });
  }

  it('PrintSheet.css reads the card header gradient from --print-header-gradient tokens, not the literal stops', () => {
    const css = read('features/printables/PrintSheet.css');
    expect(css).toMatch(/var\(--print-header-gradient-start\)/);
    expect(css).toMatch(/var\(--print-header-gradient-end\)/);
    expect(css).not.toMatch(/#002a5c/i);
    expect(css).not.toMatch(/#0b4f9e/i);
  });

  it('PrintDecor.tsx\'s DerbyCar defaults to --print-primary-color, not --scouting-blue', () => {
    expect(read('features/printables/components/PrintDecor.tsx')).toMatch(
      /var\(--print-primary-color/,
    );
  });
});

describe('the Display surface reads its own tokens, not the App surface\'s (#498)', () => {
  it('Observation.tsx does not read --cub-scouting-gold directly, and reads --display-accent-color instead', () => {
    const observation = read('features/observation/pages/Observation.tsx');
    expect(observation).not.toMatch(/var\(--cub-scouting-gold/);
    expect(observation).toMatch(/var\(--display-accent-color/);
  });

  it('AwardCeremony.tsx does not read --cub-scouting-gold directly, and reads --display-accent-color instead', () => {
    const ceremony = read('features/awards/pages/AwardCeremony.tsx');
    expect(ceremony).not.toMatch(/var\(--cub-scouting-gold/);
    expect(ceremony).toMatch(/var\(--display-accent-color/);
  });

  it('index.css defines the Display and Printables surface tokens, defaulted to today\'s colours', () => {
    const css = read('index.css');
    expect(css).toMatch(/--display-bg-color:\s*#0A0A0A/i);
    expect(css).toMatch(/--display-surface-color:\s*#1a1a1a/i);
    expect(css).toMatch(/--display-accent-color:\s*#FCD116/i);
    expect(css).toMatch(/--print-primary-color:\s*#003F87/i);
    expect(css).toMatch(/--print-accent-color:\s*#FCD116/i);
  });

  it('the .projector-mode block reads --display-* tokens rather than hardcoding the dark palette a second time', () => {
    const css = read('index.css');
    const start = css.indexOf('.projector-mode {');
    const end = css.indexOf('.results-overlay {');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const projectorBlock = css.slice(start, end);
    expect(projectorBlock).toMatch(/var\(--display-bg-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-surface-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-surface-alt-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-text-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-text-muted-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-border-color\)/);
    expect(projectorBlock).toMatch(/var\(--display-accent-color\)/);
    // The dark palette's own literal values must not reappear as a second,
    // freshly hardcoded override sitting beside the token that replaced it.
    expect(projectorBlock).not.toMatch(/#0A0A0A/i);
    expect(projectorBlock).not.toMatch(/#1a1a1a/i);
  });

  it('.results-overlay and the .overlay-* rules read --display-* tokens, not the App surface\'s', () => {
    const css = read('index.css');
    const start = css.indexOf('.results-overlay {');
    const end = css.indexOf('/* Overlay Avatar */');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const overlayBlock = css.slice(start, end);
    expect(overlayBlock).toMatch(/var\(--display-overlay-bg-color\)/);
    expect(overlayBlock).toMatch(/var\(--display-accent-color\)/);
    expect(overlayBlock).toMatch(/var\(--display-surface-color\)/);
    expect(overlayBlock).toMatch(/var\(--display-text-color\)/);
    expect(overlayBlock).toMatch(/var\(--display-text-muted-color\)/);
  });
});

describe('AwardArtwork takes an explicit palette instead of a hardcoded module-level colour (#498)', () => {
  it('artwork.tsx has no module-level GOLD/BLUE constant', () => {
    const artwork = read('features/awards/artwork.tsx');
    expect(artwork).not.toMatch(/^const GOLD =/m);
    expect(artwork).not.toMatch(/^const BLUE =/m);
  });

  it('artwork.tsx exposes a palette prop', () => {
    expect(read('features/awards/artwork.tsx')).toMatch(/palette\?:\s*ArtworkPalette/);
  });

  it('Certificate.tsx (Printables) passes AwardArtwork the Printables surface\'s own palette', () => {
    const certificate = read('features/printables/pages/Certificate.tsx');
    expect(certificate).toMatch(/print-primary-color/);
    expect(certificate).toMatch(/print-accent-color/);
  });

  it('AwardCeremony.tsx (Display) passes AwardArtwork the Display surface\'s own palette', () => {
    const ceremony = read('features/awards/pages/AwardCeremony.tsx');
    expect(ceremony).toMatch(/display-text-color/);
    expect(ceremony).toMatch(/display-accent-color/);
  });

  it('Awards.tsx (App) still needs no palette prop — the default already is the App surface\'s tokens, and derives variant from the App theme (#498)', () => {
    const awards = read('features/awards/pages/Awards.tsx');
    expect(awards).toContain(
      "<AwardArtwork\n                artworkKey={award.artworkKey}\n                size={32}\n                variant={appIsDark ? 'dark' : 'light'}\n              />",
    );
  });
});

describe('the Display surface has been fully converged — no App-token colour reads remain (#498, stage 2)', () => {
  // Stage 1's groundwork PR left two spots reading --scouting-blue directly,
  // documented as deliberate and deferred to "the theme work that actually
  // decides." This is that decision: both now join the rest of the Display
  // surface, reading --display-bg-color instead — see each call site's own
  // comment for why that specific token (there is still no "text on
  // Display accent" role in the vocabulary) and themes.test.ts's contrast
  // check pinning that every theme's pairing clears 4.5:1.
  it('AwardCeremony.tsx\'s background joins the rest of the Display surface', () => {
    const ceremony = read('features/awards/pages/AwardCeremony.tsx');
    expect(ceremony).not.toMatch(/var\(--scouting-blue/);
    expect(ceremony).toMatch(/background: 'var\(--display-bg-color, #0A0A0A\)'/);
  });

  it('the record-break banner (index.css) reads --display-bg-color, not --scouting-blue', () => {
    const css = read('index.css');
    expect(css).not.toMatch(/\.overlay-record-banner[^}]*--scouting-blue/s);
    expect(css).toMatch(/color: var\(--display-bg-color\);/);
  });

  it('Observation.tsx no longer reads --scouting-blue at all, including for its "Launch Projector Mode" button (#527)', () => {
    // Stage 2 kept two --scouting-blue reads here on the theory that the
    // "Launch Projector Mode" button is "an operator control on the light
    // standard-mode preview, not audience content" — but the whole page,
    // preview included, is the Display surface (#527's own framing), and
    // that button sits inside the same root that already applies the
    // Display theme's tokens. It now reads --display-accent-color, the
    // same token every other brand-coloured mark on this page uses.
    const observation = read('features/observation/pages/Observation.tsx');
    expect(observation).not.toMatch(/var\(--scouting-blue/);
    expect(observation).toMatch(/var\(--display-accent-color/);
  });
});

describe('the new App/Printables tokens #498 stage 2 adds are defined (index.css)', () => {
  it('the rest of the App surface\'s token vocabulary', () => {
    const css = read('index.css');
    for (const token of [
      '--surface-color',
      '--surface-alt-color',
      '--border-color',
      '--text-muted-color',
      '--on-primary-color',
      '--on-accent-color',
      '--focus-ring-color',
    ]) {
      expect(css, `missing ${token}`).toContain(`${token}:`);
    }
  });

  it('the rest of the Printables surface\'s token vocabulary', () => {
    const css = read('index.css');
    for (const token of [
      '--print-surface-color',
      '--print-text-color',
      '--print-text-muted-color',
      '--print-decor-strength',
    ]) {
      expect(css, `missing ${token}`).toContain(`${token}:`);
    }
  });

  it('.primary-btn / .secondary-btn read the new on-primary/on-accent tokens', () => {
    const css = read('index.css');
    expect(css).toMatch(/\.primary-btn\s*\{[^}]*var\(--on-primary-color/s);
    expect(css).toMatch(/\.secondary-btn\s*\{[^}]*var\(--on-accent-color/s);
  });
});

describe('theme-conditional structural CSS exists for Clear Sight and Newsprint (#498)', () => {
  it('index.css has Clear Sight rules', () => {
    expect(read('index.css')).toContain("[data-theme='clear-sight']");
  });

  it('PrintSheet.css has Newsprint rules for the header, the checker/wash/guilloche opacity, and the single-ink override', () => {
    const css = read('features/printables/PrintSheet.css');
    expect(css).toContain("[data-theme='newsprint']");
    expect(css).toMatch(/opacity: var\(--print-decor-strength/);
    expect(css).toMatch(/var\(--print-decor-color\)/);
  });
});

/**
 * Regression guard for #501 — the app-wide sweep that converted the ~140
 * files #498 left reading inline colour literals. Converted in five
 * reviewed batches (App, Racing, Observation/Printables, Settings/Stats,
 * and a residual round that added the tokens below). This does not re-walk
 * every file; it pins that the files the sweep touched cannot quietly
 * regrow a raw literal — the same shape as the #439 and #498 guards above,
 * generalised to every migrated file at once instead of one string per
 * file, because there are ~140 tokens' worth of them.
 *
 * A literal surviving here is not an oversight: it is one of the sweep's
 * own exempt categories (an elevation box-shadow, a medal colour, the
 * getContrastColor() fallback — that function does hex math, so it keeps
 * a real hex string), a var() fallback (documentation of the token's own
 * default, not a bypass of it), or a residual the sweep found no exact
 * ledger match for and reported rather than guessed (a decorative
 * PrintSheet gradient, a translucent white overlay on a coloured surface,
 * the serial-log terminal readout — theme-invariant the same way
 * TimerStatusBadge.css already is). ALLOWED_LITERAL is a category
 * allowlist, not a per-line one: it is deliberately as permissive as the
 * exemption it encodes (any elevation shadow, any medal hex) so a new use
 * of an already-exempt category does not need a test edit — only a
 * genuinely new, unmapped literal fails the build.
 */

const MIGRATED_FILES = [
  'components/ui/CameraCapture.tsx',
  'components/ui/Modal.tsx',
  'components/ui/StatusBanner.tsx',
  'context/AlertContext.tsx',
  'features/awards/artwork.tsx',
  'features/awards/components/AwardForm.tsx',
  'features/awards/components/BallotShare.tsx',
  'features/awards/pages/Awards.tsx',
  'features/awards/pages/VotingBallot.tsx',
  'features/core/components/Navigation.tsx',
  'features/core/components/UnlockButton.tsx',
  'features/management/components/BulkPhotoUploadModal.tsx',
  'features/management/components/CheckInProgress.tsx',
  'features/management/components/RacingGroupManager.tsx',
  'features/management/components/ImportRacersModal.tsx',
  'features/management/components/NoHeatsBadge.tsx',
  'features/management/components/RaceForm.tsx',
  'features/management/components/RacerCombobox.tsx',
  'features/management/components/RacerForm.tsx',
  'features/management/components/SetupChecklist.tsx',
  'features/management/pages/Home.tsx',
  'features/management/pages/RaceDetails.tsx',
  'features/observation/components/DisplaysPanel.tsx',
  'features/observation/components/PhotoSlideshow.tsx',
  'features/observation/pages/Observation.tsx',
  'features/printables/PrintSheet.css',
  'features/printables/components/CheckInScanner.tsx',
  'features/printables/components/PrintDecor.tsx',
  'features/printables/pages/HeatSheet.tsx',
  'features/printables/pages/ResultsSheet.tsx',
  'features/racing/components/FakeTimerMole.tsx',
  'features/racing/components/FreeRaceExecution.tsx',
  'features/racing/components/FreeRaceLaneSetup.tsx',
  'features/racing/components/FreeRaceTab.tsx',
  'features/racing/components/HardwareTimerMole.tsx',
  'features/racing/components/RaceExecution.tsx',
  'features/racing/components/ReadinessStrip.tsx',
  'features/racing/components/RoundConfigModal.tsx',
  'features/racing/components/RoundWizard.tsx',
  'features/racing/components/ScheduleManagement.tsx',
  'features/racing/components/SerialProxyConnector.css',
  'features/racing/components/SerialProxyConnector.tsx',
  'features/racing/pages/RaceControl.tsx',
  'features/settings/components/AppearancePreview.tsx',
  'features/settings/components/BackupPanel.tsx',
  'features/settings/components/PinFieldRow.tsx',
  'features/settings/components/ThemePicker.tsx',
  'features/settings/components/TrackCard.tsx',
  'features/settings/components/TrackLanes.tsx',
  'features/settings/components/TrackRecords.tsx',
  'features/settings/pages/ActivityLog.tsx',
  'features/settings/pages/SystemSettings.tsx',
  'features/settings/pages/TimerDiagnostics.tsx',
  'features/stats/components/Leaderboard.tsx',
  'features/stats/pages/RaceStats.css',
  'features/stats/pages/RaceStats.tsx',
];

/** Strips comments and var() fallback arguments, so neither an issue
 * reference in prose ("#439") nor a token's own documented default
 * ("var(--print-primary-color, #003F87)") is mistaken for a literal that
 * bypasses the token system. */
function stripNoise(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/var\((--[\w-]+),\s*[^()]*\)/g, 'var($1)');
}

function hexAndRgbaLiterals(content: string): string[] {
  const cleaned = stripNoise(content);
  return [...cleaned.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0]);
}

function namedColorLiterals(content: string): string[] {
  const cleaned = stripNoise(content);
  const pattern =
    /'(white|black|red|orange|gold|silver|blue|green|purple|pink|yellow|gray|grey)'|:\s*(white|black|red|orange|gold|silver|blue|green|purple|pink|yellow|gray|grey)\s*;/g;
  return [...cleaned.matchAll(pattern)].map((m) => m[1] ?? m[2]);
}

const ALLOWED_HEX_OR_RGBA =
  /^(?:rgba\(0,\s*0,\s*0,\s*0\.\d+\)|#(?:d4af37|c0c0c0|cd7f32|ffd700)|#eee|#ffffff|#8a5a2b|#(?:d32f2f|2e7d32|003F87|FCD116|0A0A0A)|rgba\(255,\s*255,\s*255,\s*0\.\d+\)|rgba\(0,\s*63,\s*135,\s*0\.0(?:5|55)\)|rgba\(252,\s*209,\s*22,\s*0\.09\)|#000|#ef9a9a|#f2f2f2|#1e1e1e|#dcdcdc|#6fbcff|#a6e22e)$/i;

const ALLOWED_NAMED = new Set(['red', 'orange', 'gold', 'silver']);

describe('issue #501: the app-wide token sweep does not regrow raw colour literals', () => {
  for (const file of MIGRATED_FILES) {
    it(`${file}: every remaining literal is an already-reported, exempt residual`, () => {
      const content = read(file);
      const unexpectedHex = hexAndRgbaLiterals(content).filter((l) => !ALLOWED_HEX_OR_RGBA.test(l));
      const unexpectedNamed = namedColorLiterals(content).filter((c) => !ALLOWED_NAMED.has(c));
      expect(
        [...unexpectedHex, ...unexpectedNamed],
        `${file} has a colour literal outside the sweep's exempt categories — use a token, or if it ` +
          `is genuinely a new exempt case (elevation shadow, medal colour, getContrastColor() hex ` +
          `math, var() fallback, or a reported unmapped residual) extend ALLOWED_HEX_OR_RGBA / ` +
          `ALLOWED_NAMED above rather than the per-file allowlist.`,
      ).toEqual([]);
    });
  }

  it('the round-2 residual tokens this sweep added are all actually referenced (no orphan token, no missed substitution)', () => {
    const css = read('index.css');
    const themes = read('theming/themes.ts');
    for (const token of [
      '--scouting-blue-hover-color',
      '--table-row-hover-color',
      '--highlight-card-bg-color',
      '--record-highlight-bg-color',
      '--highlight-blue-tint-color',
      '--display-text-quiet-color',
      '--display-card-bg-color',
      '--display-accent-muted-color',
      '--overlay-backdrop-demo-color',
    ]) {
      expect(css, `index.css is missing ${token}`).toContain(`${token}:`);
      expect(themes, `themes.ts is missing ${token}`).toContain(`'${token}'`);
      const usedSomewhere = MIGRATED_FILES.some((f) => read(f).includes(`var(${token})`)) || css.includes(`var(${token})`);
      expect(usedSomewhere, `${token} is defined but never read anywhere`).toBe(true);
    }
  });
});

/**
 * Regression guard for #527 — Observation.tsx read eleven App-surface
 * tokens directly (`--surface-color`, `--text-color` and friends), which
 * inherit from whatever the *viewing device's own* App theme happens to be
 * (localStorage, normally Field Uniform) rather than from the organisation's
 * chosen Display theme. Under a non-default Display theme this produced
 * white-on-white timing rows once `.projector-mode`'s old `!important`
 * overrides — themselves keyed to inline colour literals #504 removed —
 * stopped masking it.
 *
 * This is deliberately scoped to the files that actually render on the wall
 * (the Display surface), not a blind walk of everything under
 * `features/observation/` — `DisplaysPanel.tsx` is the operator's own list
 * at Race Control → Displays, part of the App surface, and legitimately
 * reads App tokens.
 */
const DISPLAY_SURFACE_FILES = [
  'features/observation/pages/Observation.tsx',
  'features/observation/IdentifyPresence.tsx',
  'features/observation/components/PhotoSlideshow.tsx',
  'features/awards/pages/AwardCeremony.tsx',
];

describe('the Display surface reads no App-only token (#527)', () => {
  for (const file of DISPLAY_SURFACE_FILES) {
    it(`${file} reads no APP_TOKEN_NAMES entry that DISPLAY_TOKEN_NAMES lacks`, () => {
      const content = read(file);
      const leaked = APP_TOKEN_NAMES.filter(
        (name) => !DISPLAY_TOKEN_NAMES.includes(name) && content.includes(`var(${name}`),
      );
      expect(
        leaked,
        `${file} reads App-surface token(s) with no Display equivalent: ${leaked.join(', ')} — ` +
          `either give the Display surface its own token for the role, or read an existing ` +
          `--display-* token that already covers it.`,
      ).toEqual([]);
    });
  }
});
