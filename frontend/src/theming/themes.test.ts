import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import {
  APP_TOKEN_NAMES,
  DEFAULT_THEME_KEY,
  DISPLAY_TOKEN_NAMES,
  PRINTABLES_TOKEN_NAMES,
  THEME_KEYS,
  THEMES,
  themeByKey,
  type Theme,
} from './themes';

const isHex = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);

describe('THEMES — integrity', () => {
  it('ships exactly the seven named themes, Field Uniform first', () => {
    expect(THEMES.map((t) => t.key)).toEqual([
      'field-uniform',
      'under-the-lights',
      'old-glory',
      'clear-sight',
      'sawdust-and-pine',
      'trail-colors',
      'newsprint',
    ]);
  });

  it('has no duplicate keys', () => {
    expect(new Set(THEME_KEYS).size).toBe(THEME_KEYS.length);
  });

  it('gives every theme a name, a description and an occasion', () => {
    for (const theme of THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.occasion.length).toBeGreaterThan(0);
    }
  });

  it('defaults to Field Uniform', () => {
    expect(DEFAULT_THEME_KEY).toBe('field-uniform');
    expect(THEMES[0].key).toBe(DEFAULT_THEME_KEY);
  });

  describe('every theme defines the full token vocabulary for its surface', () => {
    for (const theme of THEMES) {
      it(`${theme.key}: app`, () => {
        for (const name of APP_TOKEN_NAMES) {
          expect(theme.app.tokens[name], `${theme.key} app is missing ${name}`).toBeDefined();
        }
        expect(Object.keys(theme.app.tokens).sort()).toEqual([...APP_TOKEN_NAMES].sort());
      });

      it(`${theme.key}: display`, () => {
        for (const name of DISPLAY_TOKEN_NAMES) {
          expect(
            theme.display.tokens[name],
            `${theme.key} display is missing ${name}`,
          ).toBeDefined();
        }
        expect(Object.keys(theme.display.tokens).sort()).toEqual([...DISPLAY_TOKEN_NAMES].sort());
      });

      it(`${theme.key}: printables — only the tokens the spec gives it`, () => {
        for (const name of Object.keys(theme.printables.tokens)) {
          expect(PRINTABLES_TOKEN_NAMES).toContain(name);
        }
        // Every theme defines the core seven; only Newsprint omits the
        // header gradient pair (its header is a rule, not a fill) and only
        // Newsprint sets the single-ink override.
        const core = [
          '--print-primary-color',
          '--print-accent-color',
          '--print-surface-color',
          '--print-text-color',
          '--print-text-muted-color',
          '--print-decor-strength',
        ];
        for (const name of core) {
          expect(
            theme.printables.tokens[name],
            `${theme.key} printables is missing ${name}`,
          ).toBeDefined();
        }
        const hasGradient =
          theme.printables.tokens['--print-header-gradient-start'] !== undefined &&
          theme.printables.tokens['--print-header-gradient-end'] !== undefined;
        const hasDecorColor = theme.printables.tokens['--print-decor-color'] !== undefined;
        if (theme.key === 'newsprint') {
          expect(hasGradient).toBe(false);
          expect(hasDecorColor).toBe(true);
        } else {
          expect(hasGradient).toBe(true);
          expect(hasDecorColor).toBe(false);
        }
      });
    }
  });

  it('every Display surface is dark — a projector never gets a light theme', () => {
    for (const theme of THEMES) {
      expect(theme.display.isDark, `${theme.key} display should be dark`).toBe(true);
    }
  });

  it('Under the Lights is the only dark App surface', () => {
    const dark = THEMES.filter((t) => t.app.isDark).map((t) => t.key);
    expect(dark).toEqual(['under-the-lights']);
  });

  it('every Printables surface is light — paper stays light even under a dark theme', () => {
    for (const theme of THEMES) {
      expect(theme.printables.isDark, `${theme.key} printables should be light`).toBe(false);
    }
  });

  it('printBehavior is as-is except the two that deliberately deviate', () => {
    const byBehavior = (behavior: string) =>
      THEMES.filter((t) => t.printables.printBehavior === behavior).map((t) => t.key);
    expect(byBehavior('lightened')).toEqual(['under-the-lights', 'newsprint']);
    expect(byBehavior('refused')).toEqual([]);
    expect(
      THEMES.filter((t) => t.printables.printBehavior === 'as-is').map((t) => t.key),
    ).toEqual(['field-uniform', 'old-glory', 'clear-sight', 'sawdust-and-pine', 'trail-colors']);
  });

  it('every token value is a hex color or a valid rgba() overlay', () => {
    for (const theme of THEMES) {
      for (const surface of [theme.app, theme.display, theme.printables]) {
        for (const [name, value] of Object.entries(surface.tokens)) {
          const ok = isHex(value) || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*[\d.]+\s*\)$/.test(value);
          const isDecorStrength = name === '--print-decor-strength';
          expect(
            ok || isDecorStrength,
            `${theme.key} ${name} = "${value}" is not a hex color, rgba(), or decor-strength`,
          ).toBe(true);
        }
      }
    }
  });

  it('field-uniform is exactly today\'s shipped palette — the invariant #498 requires', () => {
    const fieldUniform = themeByKey('field-uniform');
    expect(fieldUniform.app.tokens['--scouting-blue']).toBe('#003F87');
    expect(fieldUniform.app.tokens['--cub-scouting-gold']).toBe('#FCD116');
    expect(fieldUniform.app.tokens['--scouting-red']).toBe('#D63232');
    expect(fieldUniform.app.tokens['--background-color']).toBe('#f5f5f5');
    expect(fieldUniform.app.tokens['--text-color']).toBe('#333333');
    expect(fieldUniform.display.tokens['--display-bg-color']).toBe('#0A0A0A');
    expect(fieldUniform.display.tokens['--display-surface-color']).toBe('#1a1a1a');
    expect(fieldUniform.display.tokens['--display-accent-color']).toBe('#FCD116');
    expect(fieldUniform.printables.tokens['--print-primary-color']).toBe('#003F87');
    expect(fieldUniform.printables.tokens['--print-accent-color']).toBe('#FCD116');
    expect(fieldUniform.printables.printBehavior).toBe('as-is');
  });
});

describe('themeByKey', () => {
  it('finds a real theme', () => {
    expect(themeByKey('old-glory').name).toBe('Old Glory');
  });

  it('falls back to Field Uniform for an unrecognised key', () => {
    expect(themeByKey('a-theme-from-the-future').key).toBe('field-uniform');
    expect(themeByKey('').key).toBe('field-uniform');
  });
});

describe('contrast — the hard constraints checklist', () => {
  // Body text >= 4.5:1, large display text >= 3:1. Computed from the
  // literal token values above rather than trusting the spec's own
  // hand-measured numbers to still hold after a future edit.
  const BODY_TEXT_FLOOR = 4.5;
  const LARGE_TEXT_FLOOR = 3;

  function check(theme: Theme) {
    it(`${theme.key}: app text on background clears ${BODY_TEXT_FLOOR}:1`, () => {
      expect(
        contrastRatio(theme.app.tokens['--text-color'], theme.app.tokens['--background-color']),
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    });

    it(`${theme.key}: app on-primary on primary clears ${BODY_TEXT_FLOOR}:1`, () => {
      expect(
        contrastRatio(
          theme.app.tokens['--on-primary-color'],
          theme.app.tokens['--scouting-blue'],
        ),
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    });

    it(`${theme.key}: display text on background clears ${BODY_TEXT_FLOOR}:1`, () => {
      expect(
        contrastRatio(
          theme.display.tokens['--display-text-color'],
          theme.display.tokens['--display-bg-color'],
        ),
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    });

    it(`${theme.key}: display accent on background clears ${LARGE_TEXT_FLOOR}:1 (large text)`, () => {
      expect(
        contrastRatio(
          theme.display.tokens['--display-accent-color'],
          theme.display.tokens['--display-bg-color'],
        ),
      ).toBeGreaterThanOrEqual(LARGE_TEXT_FLOOR);
    });

    it(`${theme.key}: printables text on surface clears ${BODY_TEXT_FLOOR}:1`, () => {
      expect(
        contrastRatio(
          theme.printables.tokens['--print-text-color'],
          theme.printables.tokens['--print-surface-color'],
        ),
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    });
  }

  for (const theme of THEMES) {
    check(theme);
  }

  it('display-bg-color reads as text on the display accent fill (the overlay record banner, #498 stage 2)', () => {
    // There is no "Display text-on-accent" token in the spec's vocabulary,
    // so `.overlay-record-banner` and AwardCeremony's timing-record banner
    // both reuse `--display-bg-color` for that role — this pins that every
    // theme's pairing clears the body-text floor, so a future theme cannot
    // silently break it.
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          theme.display.tokens['--display-bg-color'],
          theme.display.tokens['--display-accent-color'],
        ),
        `${theme.key}: display-bg-color on display-accent-color`,
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    }
  });

  it('display-on-accent-color reads as text on the display accent fill (#527)', () => {
    // #501 added --display-on-accent-color to close the gap the comment
    // above describes — the standings thead, the Standings/Timing tab
    // pills and the exhibition badge (Observation.tsx, standard mode) all
    // read it now that they are no longer reading an App-surface token for
    // this role. It is flat #000000 across every theme, so this is really
    // one check per accent colour, but stating it per theme keeps the
    // failure message naming the theme that broke it.
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          theme.display.tokens['--display-on-accent-color'],
          theme.display.tokens['--display-accent-color'],
        ),
        `${theme.key}: display-on-accent-color on display-accent-color`,
      ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    }
  });

  // #498's checklist covered five pairings. By the time APP_TOKEN_NAMES had
  // grown to 110 entries, the rest of the vocabulary was untested — and
  // three tokens (the ones #529 is about) failed the floor in every theme,
  // Clear Sight included. This extends coverage to every token whose name
  // says it is text — `--text-*` and `--display-text-*` — plus
  // `--on-accent-color` against `--cub-scouting-gold`, which #529's own
  // audit found already clears the floor everywhere (5.93:1 at the
  // tightest) and was simply never checked.
  describe('every --text-* and --display-text-* token, plus on-accent (#529)', () => {
    // --text-placeholder-color is the one deliberate exception, in six of
    // the seven themes: darkened to clear the floor it would stop reading
    // as an empty field and start reading as typed text (placeholder text
    // is not content — see each theme's own comment in themes.ts). Clear
    // Sight is not in this set: its whole purpose is legibility, so its
    // placeholder is pushed to clear the floor like everything else on that
    // theme rather than carrying the same exception.
    const PLACEHOLDER_EXCEPTION_THEMES = new Set([
      'field-uniform',
      'under-the-lights',
      'old-glory',
      'sawdust-and-pine',
      'trail-colors',
      'newsprint',
    ]);

    const APP_TEXT_TOKEN_NAMES = APP_TOKEN_NAMES.filter(
      (name) => name.startsWith('--text-') && name !== '--text-color',
    );
    const DISPLAY_TEXT_TOKEN_NAMES = DISPLAY_TOKEN_NAMES.filter(
      (name) => name.startsWith('--display-text-') && name !== '--display-text-color',
    );

    for (const theme of THEMES) {
      for (const name of APP_TEXT_TOKEN_NAMES) {
        const ratio = contrastRatio(theme.app.tokens[name], theme.app.tokens['--surface-color']);
        const isDocumentedException =
          name === '--text-placeholder-color' && PLACEHOLDER_EXCEPTION_THEMES.has(theme.key);

        if (isDocumentedException) {
          it(`${theme.key}: ${name} on surface is a documented below-floor exception (placeholder text is not content)`, () => {
            // Still darkened on purpose, not the pre-#529 1.92:1 — an
            // unchecked token and a knowingly-exempt one must not look
            // identical, so this pins the exception explicitly rather than
            // omitting the pairing.
            expect(ratio).toBeGreaterThanOrEqual(LARGE_TEXT_FLOOR);
            expect(ratio).toBeLessThan(BODY_TEXT_FLOOR);
          });
        } else {
          it(`${theme.key}: ${name} on surface clears ${BODY_TEXT_FLOOR}:1`, () => {
            expect(ratio).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
          });
        }
      }

      for (const name of DISPLAY_TEXT_TOKEN_NAMES) {
        it(`${theme.key}: ${name} on display background clears ${BODY_TEXT_FLOOR}:1`, () => {
          expect(
            contrastRatio(theme.display.tokens[name], theme.display.tokens['--display-bg-color']),
          ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
        });
      }

      it(`${theme.key}: on-accent-color on cub-scouting-gold clears ${BODY_TEXT_FLOOR}:1`, () => {
        expect(
          contrastRatio(
            theme.app.tokens['--on-accent-color'],
            theme.app.tokens['--cub-scouting-gold'],
          ),
        ).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
      });
    }
  });

  // The three pairings the spec's design work explicitly considered and
  // rejected — pinned here so the reasoning stays checked against the
  // contrast utility itself, not just asserted in prose.
  describe('rejected pairings — pinned as design decisions, not shipped', () => {
    it('Old Glory: red heading text on the Display navy fails the large-text floor', () => {
      // Old Glory Red (the app accent token's value) on the Display bg —
      // why headings keep the gold instead.
      expect(contrastRatio('#B31942', '#0A1E3D')).toBeLessThan(LARGE_TEXT_FLOOR);
    });

    it('Clear Sight: the literal gold as text-on-white fails badly', () => {
      expect(contrastRatio('#FCD116', '#ffffff')).toBeLessThan(BODY_TEXT_FLOOR);
    });

    it('Newsprint: black on the masthead red fails the body-text floor', () => {
      expect(contrastRatio('#000000', '#B31B1B')).toBeLessThan(BODY_TEXT_FLOOR);
      // ...which is why on-accent is white instead, and clears it.
      expect(contrastRatio('#ffffff', '#B31B1B')).toBeGreaterThanOrEqual(BODY_TEXT_FLOOR);
    });
  });
});
