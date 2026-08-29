import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    expect(banner).toMatch(/fffbea/i);
    expect(banner).toMatch(/f0f9f0/i);
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

  it('Awards.tsx (App) still needs no palette prop — the default already is the App surface\'s tokens', () => {
    const awards = read('features/awards/pages/Awards.tsx');
    expect(awards).toContain('<AwardArtwork artworkKey={award.artworkKey} size={32} />');
  });
});

describe('two direct App-token reads remain in the Display surface, deliberately, pending the theme work (#498)', () => {
  // Both are cases where the spec's own 8-token Display vocabulary has no
  // matching role (there is no "on-accent" or "primary" Display token), so
  // converting either would either invent a token outside that vocabulary or
  // silently move a colour that is shipped and screenshotted today. Left as
  // literal reads rather than guessed at; each is commented at its call
  // site. This test exists so the gap reads as "known and deferred" rather
  // than "missed" the next time someone greps for `--scouting-blue`.
  it('AwardCeremony.tsx keeps its navy background', () => {
    const ceremony = read('features/awards/pages/AwardCeremony.tsx');
    expect(ceremony).toMatch(/background: 'var\(--scouting-blue, #003F87\)'/);
  });

  it('the record-break banner keeps --scouting-blue text on its gold fill', () => {
    expect(read('index.css')).toMatch(/color: var\(--scouting-blue\);/);
  });

  it('Observation.tsx keeps --scouting-blue for its own "Launch Projector Mode" button and timing-record-banner text, for the same reason', () => {
    const observation = read('features/observation/pages/Observation.tsx');
    const matches = observation.match(/var\(--scouting-blue/g) ?? [];
    // The button's border+text colour, and the standard-view timing-record
    // banner's text colour — three reads, none of them gold, none of them
    // convertible without inventing a Display token the spec doesn't define.
    expect(matches.length).toBe(3);
  });
});
