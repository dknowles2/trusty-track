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

  it('PrintDecor.tsx\'s vehicle glyphs default to --print-primary-color, not --scouting-blue', () => {
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
      "<AwardArtwork\n                  artworkKey={award.artworkKey}\n                  size={32}\n                  variant={appIsDark ? 'dark' : 'light'}\n                />",
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

/** Strips a GraphQL `#` line comment to end-of-line. Only ever applied to a
 * template-literal body already known to be a GraphQL document — a bare `#`
 * elsewhere (JS/TS prose, JSX) is still a candidate colour literal. */
function stripGraphQLLineComments(body: string): string {
  return body.replace(/#[^\n]*/g, '');
}

/** True for a template-literal body that reads as a GraphQL document: the
 * first non-whitespace token is `query`/`mutation`/`subscription`/`fragment`.
 * Not every document here is wrapped in the `gql` tag — some (`Observation.tsx`'s
 * `championshipResultQuery`) are plain strings because they interpolate
 * runtime values codegen can't type — so this is checked whether or not a
 * `gql`/`graphql` tag precedes the backtick. */
function looksLikeGraphQLDocument(body: string): boolean {
  return /^\s*(?:query|mutation|subscription|fragment)\b/.test(body);
}

/** Strips comments and var() fallback arguments, so neither an issue
 * reference in prose ("#439") nor a token's own documented default
 * ("var(--print-primary-color, #003F87)") is mistaken for a literal that
 * bypasses the token system. Also strips GraphQL `#` line comments inside a
 * `gql`/`graphql`-tagged (or otherwise recognisable) template literal, so an
 * issue reference in a query document's own comment ("# ... (#1073)") is not
 * mistaken for the hex colour `#1073` (#1131). */
function stripNoise(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/var\((--[\w-]+),\s*[^()]*\)/g, 'var($1)')
    .replace(/(\b(?:gql|graphql)\s*)?`([^`]*)`/g, (match, tag: string | undefined, body: string) => {
      if (!tag && !looksLikeGraphQLDocument(body)) return match;
      return `${tag ?? ''}\`${stripGraphQLLineComments(body)}\``;
    });
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

describe('stripNoise / hexAndRgbaLiterals: GraphQL comments inside a gql document (#1131)', () => {
  it('does not read an issue reference in a gql-tagged document comment as a colour', () => {
    const src = "const Q = gql`\n  query Foo {\n    # see #1073\n    bar\n  }\n`;";
    expect(hexAndRgbaLiterals(src)).toEqual([]);
  });

  it('does not read an issue reference in an untagged GraphQL document comment as a colour', () => {
    // Observation.tsx's own queries are plain strings, not `gql`-tagged,
    // because they interpolate a runtime id codegen can't type.
    const src = 'const Q = `\n  query Foo {\n    # see #1073\n    bar\n  }\n`;';
    expect(hexAndRgbaLiterals(src)).toEqual([]);
  });

  it('still reads a real hex literal outside any comment', () => {
    const src = "const c = '#1073ab';";
    expect(hexAndRgbaLiterals(src)).toEqual(['#1073ab']);
  });

  it('still reads a real hex literal that sits right next to a gql document, unaffected by it', () => {
    const src = "const Q = gql`query Foo { bar }`;\nconst c = '#1073ab';";
    expect(hexAndRgbaLiterals(src)).toEqual(['#1073ab']);
  });

  it('does not eat the closing backtick when the document body ends in a comment', () => {
    // If stripping "#...to end of line" ever ran past the body's own
    // closing backtick, the outer content would be malformed and swallow
    // whatever follows — assert that a real literal right after the
    // document is still seen.
    const src = "const Q = gql`\n  query Foo {\n    bar\n  }\n  # trailing comment, no newline after\n`;\nconst c = '#003F87';";
    expect(hexAndRgbaLiterals(src)).toEqual(['#003F87']);
  });

  it('does not mistake a hash inside a non-comment string argument for a comment start', () => {
    // Not a case that matters for colours (there's no hex-looking run right
    // after it), but confirm it doesn't corrupt the rest of the document.
    const src = 'const Q = gql`\n  query Foo {\n    bar(name: "#1")\n    baz\n  }\n`;\nconst c = \'#003F87\';';
    expect(hexAndRgbaLiterals(src)).toEqual(['#003F87']);
  });

  it('a plain backtick string that is not a GraphQL document is untouched — a "#" in it still counts', () => {
    const src = 'const c = `#1073ab`;';
    expect(hexAndRgbaLiterals(src)).toEqual(['#1073ab']);
  });
});

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

/**
 * Regression guard for #1061 — `.racer-row:hover` painted `#f8f9fa` behind
 * text that inherits the App surface's `--text-color`. Under Under the
 * Lights that text is `#eef1f6`, so hovering a roster row put near-white
 * text on a near-white row (~1.03:1) — the selected-row state right beside
 * it (`RaceDetails.tsx`) already used `var(--surface-hover-color)`, which
 * every theme defines; the hover rule was simply the one that was missed.
 */
describe('the roster row hover state reads the surface-hover token, not a literal (#1061)', () => {
  it('.racer-row:hover uses var(--surface-hover-color)', () => {
    const css = read('index.css');
    const match = css.match(/\.racer-row:hover\s*\{([^}]*)\}/);
    expect(match, '.racer-row:hover rule not found').not.toBeNull();
    expect(match![1]).toMatch(/var\(--surface-hover-color\)/);
    expect(match![1]).not.toMatch(/#f8f9fa/i);
  });
});

/**
 * General guard for #1061 — #504 migrated inline `style={{}}` literals in
 * `.tsx` files, but the ordinary App-surface rules in `index.css` were
 * never swept the same way, and nothing here asserted a rule about them.
 * Five of the roughly thirty literal colour declarations it left behind
 * were not harmless: a roster row that vanished on hover, a light-mode
 * dropdown menu, a wholly unthemed phone-width roster, and two disabled
 * buttons — all still light-mode-only regardless of the active theme.
 *
 * This walks every rule body in `index.css` *outside* `:root` (the pre-JS
 * Field Uniform fallback, which is expected and pinned elsewhere to match
 * themes.ts) and refuses a hex or rgb()/rgba()/hsl()/hsla() literal, or a
 * bare `white`/`black` keyword, on any colour-bearing property — with an
 * explicit, reasoned allowlist for the ones that are genuinely fine to
 * leave, matching the issue's own list: medal borders and their shadows on
 * the results overlay, ordinary box-shadows (which read as depth, not
 * theme, regardless of surface colour), the settings-nav hover tint, the
 * disabled toggle-knob's white circle, the demo-paused overlay, and
 * `.form-control`'s border / `.theme-swatch`'s border (named explicitly in
 * the issue as fine to leave). A future hover state — or anything else —
 * written with a fresh literal fails this rather than waiting for somebody
 * to switch on a dark theme and move their mouse.
 */
describe('index.css declares no literal colour outside :root, except an explicit allowlist (#1061)', () => {
  const COLOR_PROPERTY_RE =
    /^(color|background|background-color|background-image|border|border-[a-z-]+|outline|outline-color|fill|stroke|box-shadow|text-shadow)$/;
  // A hex literal, an rgb()/rgba()/hsl()/hsla() function, or a bare
  // `white`/`black` keyword — checked only after every `var(...)` reference
  // in the value has been stripped, so `var(--on-primary-color,
  // var(--white))` (a token fallback chain, not a literal) does not trip
  // the bare-keyword half of this check.
  const LITERAL_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\(|\bwhite\b|\bblack\b/i;

  // (selector, property) — normalized to a single space between tokens —
  // and why each is left as a literal rather than a token.
  const ALLOWLIST: Record<string, string> = {
    // The switch knob is a fixed white circle that has to read clearly
    // against *two* different track colours (the neutral unchecked track
    // and the accent-blue checked one) in every theme; a token that moves
    // with the theme risks landing close to one of those two and nearly
    // disappearing, which is worse than a knob that never varies.
    '.slider:before|background-color': 'the toggle knob is a fixed white circle by design',

    // Ordinary depth shadows: they read as elevation, not surface colour,
    // and stay a translucent black in every existing theme (themes.test.ts
    // covers the App/Display/Printables shadow tokens that do vary; these
    // predate #498 and were never migrated because nothing about them
    // looks wrong under a dark theme).
    '.dropdown-content|box-shadow': 'ordinary drop shadow, reads as depth in every theme',
    '.split-btn-main|border-right': 'a hairline separator between the two halves of a split button',
    '.racer-card-photo|box-shadow': 'ordinary drop shadow, reads as depth in every theme',
    '.projector-mode .heat-card, .projector-mode .heat-card-racer|box-shadow':
      'ordinary drop shadow, reads as depth in every theme',
    '.demo-paused-card|box-shadow': 'ordinary drop shadow, reads as depth in every theme',

    // Medal borders/shadows and the gold accents beside them on the results
    // overlay — the issue names these explicitly as harmless: they are the
    // Display surface's own award colours (gold/silver/bronze), not App
    // surface text or backgrounds that a theme is meant to repaint.
    '.overlay-title|text-shadow': 'gold glow behind the results-overlay title, part of the award colour, not the surface',
    '.overlay-record-banner|box-shadow': 'gold glow on the track-record banner, part of the award colour, not the surface',
    '.overlay-result-item|border-left': 'unplaced default left-border colour, alongside the medal colours below',
    '.overlay-result-item|box-shadow': 'ordinary drop shadow, reads as depth in every theme',
    '.overlay-result-item.first-place|background': 'gold-tinted gradient, part of the medal colours',
    '.overlay-result-item.second-place|border-left-color': 'silver medal colour',
    '.overlay-result-item.third-place|border-left-color': 'bronze medal colour',

    // The demo-paused overlay is its own small, self-contained card, kept
    // deliberately light regardless of the active theme (like a browser's
    // own fixed-appearance dialog) — out of scope for this issue's
    // App-surface sweep. Its button text was not: `color: white` on a
    // `var(--scouting-blue)` background is the same pattern `.primary-btn`
    // already solves with `--on-primary-color`, so that one was converted
    // rather than allowlisted (as was `.settings-nav
    // button[aria-current='page']`'s identical pattern, found by this same
    // guard).
    '.demo-paused-card|background': 'the demo-paused card is a self-contained light card, out of scope here',

    '.lane-photo-picker-btn[aria-checked=\'true\']|box-shadow': 'ordinary drop shadow, reads as depth in every theme',

    // Named explicitly in the issue as fine to leave.
    '.settings-nav button:hover|background': 'named in the issue as harmless',
    '.settings-nav-link:hover|background': 'named in the issue as harmless',
    '.form-control|border': "named in the issue as fine to leave",
    '.theme-swatch|border': "named in the issue as fine to leave",
  };

  function withoutRoot(css: string): string {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rootStart = withoutComments.indexOf(':root');
    const rootOpenBrace = withoutComments.indexOf('{', rootStart);
    // :root holds only flat custom-property declarations, no nested rules,
    // so the next closing brace is its own.
    const rootCloseBrace = withoutComments.indexOf('}', rootOpenBrace);
    return withoutComments.slice(0, rootStart) + withoutComments.slice(rootCloseBrace + 1);
  }

  function literalDeclarationsOutsideRoot(
    css: string,
  ): { selector: string; property: string; value: string }[] {
    const body = withoutRoot(css);
    const findings: { selector: string; property: string; value: string }[] = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRe.exec(body)) !== null) {
      const selector = ruleMatch[1].trim().replace(/\s+/g, ' ');
      if (selector.startsWith('@keyframes') || selector.startsWith('@font-face')) continue;
      const declarations = ruleMatch[2].split(';');
      for (const raw of declarations) {
        const colonIdx = raw.indexOf(':');
        if (colonIdx === -1) continue;
        const property = raw.slice(0, colonIdx).trim().toLowerCase();
        if (!COLOR_PROPERTY_RE.test(property)) continue;
        let value = raw.slice(colonIdx + 1).trim();
        // Strip every var(...) reference (including a fallback chain like
        // var(--on-primary-color, var(--white))) before testing for a
        // literal — a custom-property *name* is not a literal colour.
        let previous: string;
        do {
          previous = value;
          value = value.replace(/var\([^()]*\)/g, '');
        } while (value !== previous);
        if (LITERAL_COLOR_RE.test(value)) {
          findings.push({ selector, property, value: raw.trim() });
        }
      }
    }
    return findings;
  }

  it('every literal colour declaration found outside :root is on the allowlist', () => {
    const findings = literalDeclarationsOutsideRoot(read('index.css'));
    const unlisted = findings.filter((f) => !(`${f.selector}|${f.property}` in ALLOWLIST));
    expect(
      unlisted,
      unlisted
        .map((f) => `${f.selector} { ${f.property}: ... } — not on the allowlist (${f.value})`)
        .join('\n'),
    ).toEqual([]);
  });

  it('the allowlist names nothing that index.css no longer has', () => {
    const findings = literalDeclarationsOutsideRoot(read('index.css'));
    const found = new Set(findings.map((f) => `${f.selector}|${f.property}`));
    const stale = Object.keys(ALLOWLIST).filter((key) => !found.has(key));
    expect(stale, `allowlist entries with no matching rule left in index.css: ${stale.join(', ')}`).toEqual([]);
  });
});
