/**
 * The seven themes (#498), as plain data.
 *
 * A theme has no behavior — it is a set of CSS custom property values a
 * small number of DOM nodes already know how to consume (see
 * `applyTheme.ts`). A subclass or a per-theme stylesheet would mean seven
 * copies of selectors that have to be kept in sync with every future
 * component that adds a new colored element; a plain record means adding a
 * theme is adding one object to `THEMES`, and a missing token falls back to
 * whatever the browser resolves — nothing breaks, it just under-themes.
 *
 * This file is the *one* place these values live. Nothing else — not a CSS
 * file, not the backend — holds a second copy of what a theme's colors are;
 * `index.css`'s `:root` block keeps only Field Uniform's own values, as the
 * pre-JS/no-script fallback, and they are required to match this file's
 * `field-uniform` record exactly (`themes.test.ts` pins that).
 *
 * Where every value below comes from: the seven token tables in
 * https://github.com/dknowles2/trusty-track/issues/498, transcribed exactly
 * — including the accessibility notes reproduced as comments next to the
 * pairing they measure, so a future edit to a color has to also edit (or at
 * least notice) the ratio it was chosen to clear.
 */

/** Every theme this build ships, by key. Never renamed once shipped — it is
 *  API, stored on `Group.display_theme` / `Group.printables_theme` and in
 *  each device's `localStorage`. */
export type ThemeKey =
  | 'field-uniform'
  | 'under-the-lights'
  | 'old-glory'
  | 'clear-sight'
  | 'sawdust-and-pine'
  | 'trail-colors'
  | 'newsprint';

/**
 * What Display and Printables are actually set to.
 *
 * `'MATCH_APP'` does not copy the App theme's literal colors — it means "use
 * *this* theme's own Display (or Printables) definition, for whichever
 * `ThemeKey` the App surface currently holds." See `resolveSurfaceKey` in
 * `applyTheme.ts` for what "currently holds" resolves to outside the
 * settings page's own live preview.
 */
export type SurfaceThemeSetting = 'MATCH_APP' | ThemeKey;

/** Which of the three surfaces — used by the settings picker/preview to pick
 *  the right pair of tokens off a `Theme` without repeating the surface
 *  names as string literals at every call site. */
export type PickerSurface = 'app' | 'display' | 'printables';

/** One surface's token values, plus whether it reads dark or light —
 *  `AwardArtwork`'s `variant`, the focus-ring choice on a dark surface, and
 *  a preview panel's own iconography all key off this rather than eyeballing
 *  a background color. */
export interface SurfaceTheme {
  /** CSS custom property name (e.g. `--scouting-blue`) -> value. */
  tokens: Readonly<Record<string, string>>;
  isDark: boolean;
}

/** Whether a Printables theme's palette survives being printed as specified,
 *  is deliberately lightened for the page even though the App/Display
 *  surfaces went dark, or (no theme here does this) would be refused. */
export type PrintBehavior = 'as-is' | 'lightened' | 'refused';

export interface PrintablesSurfaceTheme extends SurfaceTheme {
  printBehavior: PrintBehavior;
  printNote?: string;
}

export interface Theme {
  key: ThemeKey;
  /** What the picker calls it. */
  name: string;
  /** One sentence, parent-volunteer voice. */
  description: string;
  /** When a pack would choose it — the picker's second line. */
  occasion: string;
  app: SurfaceTheme;
  display: SurfaceTheme;
  printables: PrintablesSurfaceTheme;
}

/**
 * Every App-surface token name a theme may set. `applyTheme` clears any name
 * in this list that a theme's `tokens` map omits, so switching themes can
 * never leave a stale inline override from the theme before it — the
 * mechanism `--print-decor-color` and the Newsprint header specifically
 * depend on (see `PRINTABLES_TOKEN_NAMES` below).
 */
export const APP_TOKEN_NAMES: readonly string[] = [
  '--background-color',
  '--surface-color',
  '--surface-alt-color',
  '--text-color',
  '--text-muted-color',
  '--border-color',
  '--scouting-blue',
  '--cub-scouting-gold',
  '--scouting-red',
  '--on-primary-color',
  '--on-accent-color',
  '--focus-ring-color',
];

export const DISPLAY_TOKEN_NAMES: readonly string[] = [
  '--display-bg-color',
  '--display-surface-color',
  '--display-surface-alt-color',
  '--display-text-color',
  '--display-text-muted-color',
  '--display-border-color',
  '--display-accent-color',
  '--display-overlay-bg-color',
];

/**
 * Every Printables token name a theme may set. `--print-header-gradient-*`
 * and `--print-decor-color` are deliberately absent from six of the seven
 * themes' `tokens` maps — Newsprint is the one theme that sets
 * `--print-decor-color` (the single-ink override) and the one that omits
 * the gradient pair (its header renders as a rule, not a fill; see
 * `[data-theme="newsprint"]` in `PrintSheet.css`). Listing every name here,
 * not just the ones a given theme happens to use, is what lets `applyTheme`
 * clear a token a *previous* theme set and this one does not.
 */
export const PRINTABLES_TOKEN_NAMES: readonly string[] = [
  '--print-primary-color',
  '--print-accent-color',
  '--print-header-gradient-start',
  '--print-header-gradient-end',
  '--print-surface-color',
  '--print-text-color',
  '--print-text-muted-color',
  '--print-decor-strength',
  '--print-decor-color',
];

export const DEFAULT_THEME_KEY: ThemeKey = 'field-uniform';

export const THEMES: readonly Theme[] = [
  {
    key: 'field-uniform',
    name: 'Field Uniform',
    description: 'The look Trusty Track has always had — Scouting blue and gold, unchanged.',
    occasion:
      "The reasonable default for an ordinary race day with no occasion in particular — you don't have to pick this, it's what a fresh install already shows.",
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#f5f5f5',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#f8f9fa',
        '--text-color': '#333333',
        '--text-muted-color': '#666666',
        '--border-color': '#dddddd',
        '--scouting-blue': '#003F87',
        '--cub-scouting-gold': '#FCD116',
        '--scouting-red': '#D63232',
        '--on-primary-color': '#ffffff',
        '--on-accent-color': '#003F87',
        '--focus-ring-color': '#003F87',
      },
    },
    // Exactly today's `.projector-mode` palette, retired into token form
    // rather than redesigned (#498's stage-1 groundwork). App text
    // #333333 on #f5f5f5: 11.6:1. On-primary #ffffff on #003F87: 10.2:1.
    // Display text #ffffff on #0A0A0A: ~19:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#0A0A0A',
        '--display-surface-color': '#1a1a1a',
        '--display-surface-alt-color': '#111111',
        '--display-text-color': '#ffffff',
        '--display-text-muted-color': '#aaaaaa',
        '--display-border-color': '#333333',
        '--display-accent-color': '#FCD116',
        '--display-overlay-bg-color': 'rgba(0, 0, 0, 0.95)',
      },
    },
    // Printables text #222222 on #ffffff: ~15.9:1.
    printables: {
      isDark: false,
      printBehavior: 'as-is',
      tokens: {
        '--print-primary-color': '#003F87',
        '--print-accent-color': '#FCD116',
        '--print-header-gradient-start': '#002a5c',
        '--print-header-gradient-end': '#0b4f9e',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#222222',
        '--print-text-muted-color': '#666666',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'under-the-lights',
    name: 'Under the Lights',
    description:
      'A darker screen for the parts of the day that happen after the sun goes down — running heats with the gym lights low, or the awards ceremony that follows.',
    occasion:
      'An evening race, or any pack that dims the gym lights once the projector goes up and wants the operator’s own laptop to stop being the brightest thing in the room.',
    // `--scouting-blue` is lightened well past the brand navy (#003F87
    // would nearly vanish against a near-black background) — the same move
    // www/styles.css's own dark mode already makes. App text #eef1f6 on
    // #12161d: ~15.8:1. On-accent #0b1420 on #FCD116: ~13.6:1.
    app: {
      isDark: true,
      tokens: {
        '--background-color': '#12161d',
        '--surface-color': '#1c222c',
        '--surface-alt-color': '#242b37',
        '--text-color': '#eef1f6',
        '--text-muted-color': '#9aa7b8',
        '--border-color': '#313b4a',
        '--scouting-blue': '#5b9bd9',
        '--cub-scouting-gold': '#FCD116',
        '--scouting-red': '#ff6b6b',
        '--on-primary-color': '#0b1420',
        '--on-accent-color': '#0b1420',
        '--focus-ring-color': '#FCD116',
      },
    },
    // The same darkness the App surface now shares, taken all the way to
    // today's projector black — nobody is reading fine print off a
    // projector. Display text #ffffff on #0A0A0A: ~19:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#0A0A0A',
        '--display-surface-color': '#1a1a1a',
        '--display-surface-alt-color': '#111111',
        '--display-text-color': '#ffffff',
        '--display-text-muted-color': '#aaaaaa',
        '--display-border-color': '#333333',
        '--display-accent-color': '#FCD116',
        '--display-overlay-bg-color': 'rgba(0, 0, 0, 0.95)',
      },
    },
    // Lightened: a dark app and a dark projector do not argue for a dark
    // pit pass — the ink bill is the same regardless of what time the race
    // runs. The palette shifts cooler to read as "the same event, at
    // night." Printables text #1a1a1a on #ffffff: ~17.4:1.
    printables: {
      isDark: false,
      printBehavior: 'lightened',
      printNote:
        'The paper stays light — a dark screen does not mean a dark pit pass — but the palette shifts cooler, to read as the same event at night.',
      tokens: {
        '--print-primary-color': '#0b1420',
        '--print-accent-color': '#B9C6D6',
        '--print-header-gradient-start': '#05080d',
        '--print-header-gradient-end': '#16283f',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#1a1a1a',
        '--print-text-muted-color': '#5a5a5a',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'old-glory',
    name: 'Old Glory',
    description: 'Red, white, and blue, for a derby run on a patriotic theme.',
    occasion:
      "Packs running a patriotic-themed derby — common around Presidents' Day — where the pit passes, the standings, and the trophy slide should look like the rest of the room's decorations.",
    // The accent role token carries the flag red here instead of gold —
    // "the accent color," not literally gold, under this theme. App text
    // #1a1a1a on #f7f7f5: ~16.1:1. On-accent #ffffff on #B31942: ~6.7:1.
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#f7f7f5',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#eef2f6',
        '--text-color': '#1a1a1a',
        '--text-muted-color': '#5a5a5a',
        '--border-color': '#d8d8d8',
        '--scouting-blue': '#0A3161',
        '--cub-scouting-gold': '#B31942',
        '--scouting-red': '#D63232',
        '--on-primary-color': '#ffffff',
        '--on-accent-color': '#ffffff',
        '--focus-ring-color': '#0A3161',
      },
    },
    // Rejected: red heading text on the navy background — Old Glory Red on
    // #0A1E3D measures ~2.5:1, under the 3:1 large-text floor. Red survives
    // only as a fill behind white text (a record-break banner, a highlight
    // chip), never as running text on navy; headings keep the gold that
    // already proved out on `.projector-mode` (~11.3:1 here). Display text
    // #ffffff on #0A1E3D: ~16.6:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#0A1E3D',
        '--display-surface-color': '#142A4D',
        '--display-surface-alt-color': '#0d213b',
        '--display-text-color': '#ffffff',
        '--display-text-muted-color': '#b7c4d6',
        '--display-border-color': '#24406b',
        '--display-accent-color': '#FCD116',
        '--display-overlay-bg-color': 'rgba(10, 30, 61, 0.95)',
      },
    },
    // As-is: a navy header band and a red rule cost about the same ink as
    // Field Uniform's navy-and-gold. The licence security wash and the
    // pit-pass portrait ring use the accent (red) in place of gold.
    // Printables text #1a1a1a on #ffffff: ~17.4:1.
    printables: {
      isDark: false,
      printBehavior: 'as-is',
      tokens: {
        '--print-primary-color': '#0A3161',
        '--print-accent-color': '#B31942',
        '--print-header-gradient-start': '#06213f',
        '--print-header-gradient-end': '#123a6b',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#1a1a1a',
        '--print-text-muted-color': '#5a5a5a',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'clear-sight',
    name: 'Clear Sight',
    description:
      'Bigger, bolder, and unmistakable from across the room — for a gym where the projector fights the daylight, or for anyone who wants the screens easier to read.',
    occasion:
      'A venue with harsh overhead fluorescents or a projector competing with windows, or a volunteer at check-in who finds the default text small or the colors low-contrast. Legibility first, everything else second.',
    // Rejected: the literal gold, #FCD116, as an accent role — used as text
    // or a thin line it measures 1.47:1 against white. Deepened to a true
    // amber (#8A5A00, ~5.2:1) and standardized on white as the on-accent
    // color everywhere. App text #000000 on #ffffff: 21:1 (the strongest of
    // the seven). On-accent #ffffff on #8A5A00: ~5.2:1.
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#ffffff',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#f0f0f0',
        '--text-color': '#000000',
        '--text-muted-color': '#3d3d3d',
        '--border-color': '#000000',
        '--scouting-blue': '#002357',
        '--cub-scouting-gold': '#8A5A00',
        '--scouting-red': '#a6192e',
        '--on-primary-color': '#ffffff',
        '--on-accent-color': '#ffffff',
        '--focus-ring-color': '#000000',
      },
    },
    // The literal gold that the App surface had to deepen is reinstated
    // here: it recedes on white paper but a vivid gold on true black
    // measures ~16.7:1, the theme's strongest pairing. Display text
    // #ffffff on #000000: 21:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#000000',
        '--display-surface-color': '#000000',
        '--display-surface-alt-color': '#000000',
        '--display-text-color': '#ffffff',
        '--display-text-muted-color': '#d9d9d9',
        '--display-border-color': '#ffffff',
        '--display-accent-color': '#FCD116',
        '--display-overlay-bg-color': 'rgba(0, 0, 0, 1)',
      },
    },
    // As-is, and the theme most robust to being photocopied — no mid-tone
    // greys anywhere for a fourth-generation copy to lose. Printables text
    // #000000 on #ffffff: 21:1.
    printables: {
      isDark: false,
      printBehavior: 'as-is',
      tokens: {
        '--print-primary-color': '#002357',
        '--print-accent-color': '#8A5A00',
        '--print-header-gradient-start': '#001233',
        '--print-header-gradient-end': '#002357',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#000000',
        '--print-text-muted-color': '#3d3d3d',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'sawdust-and-pine',
    name: 'Sawdust & Pine',
    description: 'Warm, wood-toned, and a little more like a keepsake than a spreadsheet.',
    occasion:
      'A banquet night where the certificates are meant to be framed, or a milestone-anniversary derby where "handmade in the garage" is the right feeling. The palette extends the cream/wood tones the project’s own marketing site already uses.',
    // The primary role token trades navy for a workshop brown; gold is left
    // exactly as the default, since gold-beside-wood is already a natural
    // pairing. App text #2b2118 on #FDF8EE: ~14.4:1. On-primary #FDF8EE on
    // #5C3B21: ~9.1:1.
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#FDF8EE',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#F5EEDD',
        '--text-color': '#2b2118',
        '--text-muted-color': '#6b5c48',
        '--border-color': '#E4D9C0',
        '--scouting-blue': '#5C3B21',
        '--cub-scouting-gold': '#FCD116',
        '--scouting-red': '#D63232',
        '--on-primary-color': '#FDF8EE',
        '--on-accent-color': '#2b2118',
        '--focus-ring-color': '#5C3B21',
      },
    },
    // A warm dark rather than a cold one: the App surface's near-white
    // background inverts to near-black, and warm off-white text (not stark
    // white) keeps the "workshop lamp" feeling once the lights come down.
    // Display text #FBF2E1 on #1C130B: ~18:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#1C130B',
        '--display-surface-color': '#2A1D10',
        '--display-surface-alt-color': '#150E07',
        '--display-text-color': '#FBF2E1',
        '--display-text-muted-color': '#C7B79C',
        '--display-border-color': '#4a341f',
        '--display-accent-color': '#FCD116',
        '--display-overlay-bg-color': 'rgba(15, 9, 4, 0.95)',
      },
    },
    // As-is — this theme's real reason to exist: a certificate that reads
    // as a keepsake rather than a corporate form. Printables text #2b2118
    // on #FFFDF7: ~14.3:1.
    printables: {
      isDark: false,
      printBehavior: 'as-is',
      tokens: {
        '--print-primary-color': '#5C3B21',
        '--print-accent-color': '#FCD116',
        '--print-header-gradient-start': '#3c2513',
        '--print-header-gradient-end': '#6b4527',
        '--print-surface-color': '#FFFDF7',
        '--print-text-color': '#2b2118',
        '--print-text-muted-color': '#6b5c48',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'trail-colors',
    name: 'Trail Colors',
    description: "Green and gold-orange, for a day that's more about fun than formality.",
    occasion:
      'A pack fun day, a Lion/Tiger-heavy den’s first derby, or any pack that finds the corporate navy-and-gold a little stiff for a Saturday morning with juice boxes.',
    // Both role tokens move away from the corporate navy/lemon pairing
    // toward warmer, more natural hues. App text #23301F on #F4F7F1:
    // ~14:1. On-primary #ffffff on #2F6B3A: ~6.4:1. On-accent #2b1c05 on
    // #F2A93B: ~8.3:1.
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#F4F7F1',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#E9F0E3',
        '--text-color': '#23301F',
        '--text-muted-color': '#5C6E54',
        '--border-color': '#D3E0C9',
        '--scouting-blue': '#2F6B3A',
        '--cub-scouting-gold': '#F2A93B',
        '--scouting-red': '#D63232',
        '--on-primary-color': '#ffffff',
        '--on-accent-color': '#2b1c05',
        '--focus-ring-color': '#2F6B3A',
      },
    },
    // A dark forest-night green rather than the default's neutral black.
    // Display accent #F2A93B on #0E1810: ~9.1:1.
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#0E1810',
        '--display-surface-color': '#1B2A1F',
        '--display-surface-alt-color': '#0A130C',
        '--display-text-color': '#F4F7F1',
        '--display-text-muted-color': '#B9C7B2',
        '--display-border-color': '#2E4530',
        '--display-accent-color': '#F2A93B',
        '--display-overlay-bg-color': 'rgba(14, 24, 16, 0.95)',
      },
    },
    // As-is; a green header band and an orange rule cost the same ink
    // class as the default. Printables text #23301F on #ffffff: ~14:1.
    printables: {
      isDark: false,
      printBehavior: 'as-is',
      tokens: {
        '--print-primary-color': '#2F6B3A',
        '--print-accent-color': '#F2A93B',
        '--print-header-gradient-start': '#1f4d29',
        '--print-header-gradient-end': '#3f8a4c',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#23301F',
        '--print-text-muted-color': '#5C6E54',
        '--print-decor-strength': '1',
      },
    },
  },
  {
    key: 'newsprint',
    name: 'Newsprint',
    description:
      'Black ink on white paper, with almost nothing else — built for a pack printing sixty pit passes on a home inkjet that’s already running low.',
    occasion:
      'Tight print budgets. Every other theme’s printables cost roughly the same ink as the default; this is the one built specifically to cost less.',
    // Rejected: black text on the masthead red — the obvious pairing
    // measures ~3.1:1 against #B31B1B, under the 4.5:1 floor. On-accent is
    // white instead (~6.8:1); on-primary and on-accent end up the same
    // value here, which is fine. App text #000000 on #ffffff: 21:1.
    app: {
      isDark: false,
      tokens: {
        '--background-color': '#ffffff',
        '--surface-color': '#ffffff',
        '--surface-alt-color': '#f2f2f2',
        '--text-color': '#000000',
        '--text-muted-color': '#4d4d4d',
        '--border-color': '#000000',
        '--scouting-blue': '#000000',
        '--cub-scouting-gold': '#B31B1B',
        '--scouting-red': '#B31B1B',
        '--on-primary-color': '#ffffff',
        '--on-accent-color': '#ffffff',
        '--focus-ring-color': '#B31B1B',
      },
    },
    // A light App theme still cannot go on a projector as-is; it inverts
    // to black like every other theme here. The accent brightens from the
    // App surface's ink-conscious masthead red to a more saturated
    // red-orange, since a color chosen to survive as printed text is not
    // the same color a projector 40 feet away needs as a headline accent.
    // Display accent #E5484D on #000000: ~5.5:1 (short callout text only).
    display: {
      isDark: true,
      tokens: {
        '--display-bg-color': '#000000',
        '--display-surface-color': '#111111',
        '--display-surface-alt-color': '#000000',
        '--display-text-color': '#ffffff',
        '--display-text-muted-color': '#cccccc',
        '--display-border-color': '#ffffff',
        '--display-accent-color': '#E5484D',
        '--display-overlay-bg-color': 'rgba(0, 0, 0, 0.97)',
      },
    },
    // Lightened, ink-minimal: no second spot color at all — accent equals
    // primary, both black, so a strictly monochrome laser never renders
    // one as a muddy grey. The header's filled gradient is not set at all
    // (see `[data-theme="newsprint"]` in `PrintSheet.css` — the header
    // renders as a rule, not a fill). `--print-decor-strength: 0.12`
    // fades the chequered band, the licence's security wash and the
    // certificate's guilloche to about a tenth of their default opacity —
    // the discrete ornaments (corner flourish, rosette, derby car) are
    // NOT governed by this and stay full black. Printables text #000000
    // on #ffffff: 21:1.
    printables: {
      isDark: false,
      printBehavior: 'lightened',
      printNote:
        'No second ink color, and the decoration fades to about a tenth of its usual weight — this theme exists to cost less toner, not to look different for its own sake.',
      tokens: {
        '--print-primary-color': '#000000',
        '--print-accent-color': '#000000',
        '--print-surface-color': '#ffffff',
        '--print-text-color': '#000000',
        '--print-text-muted-color': '#4d4d4d',
        '--print-decor-strength': '0.12',
        '--print-decor-color': '#000000',
      },
    },
  },
];

/** A theme by key, or Field Uniform if the key is unrecognised — an old
 *  device/install holding a key from a build that renamed or dropped a
 *  theme falls back to the default rather than rendering nothing. */
export function themeByKey(key: string): Theme {
  return THEMES.find((t) => t.key === key) ?? THEMES.find((t) => t.key === DEFAULT_THEME_KEY)!;
}

/** Every key this build ships, for the picker and for validating a stored
 *  value. */
export const THEME_KEYS: readonly ThemeKey[] = THEMES.map((t) => t.key);
