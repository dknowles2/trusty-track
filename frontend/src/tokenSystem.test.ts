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
