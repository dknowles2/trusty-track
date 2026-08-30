/**
 * Applying a theme to one of the three scoping roots (#498).
 *
 * A theme is applied by setting a `data-theme="<key>"` attribute on a root
 * element and redefining that surface's tokens as inline style properties on
 * the same element — CSS custom properties inherit down the DOM, and a
 * redefinition at a descendant node shadows an ancestor's value for
 * everything under it. Nesting works for free: the Display root's
 * `data-theme` only has to win inside its own subtree, so it does not need
 * to know or care what the App surface is set to.
 *
 * `data-theme` is also read by a handful of theme-conditional CSS rules for
 * changes that are not a token value at all — Clear Sight's solid border in
 * place of a drop shadow, Newsprint's header rule in place of a filled bar —
 * see `[data-theme="clear-sight"]` / `[data-theme="newsprint"]` in
 * `index.css` and `PrintSheet.css`.
 */

import {
  APP_TOKEN_NAMES,
  DEFAULT_THEME_KEY,
  DISPLAY_TOKEN_NAMES,
  PRINTABLES_TOKEN_NAMES,
  themeByKey,
  type PrintablesSurfaceTheme,
  type SurfaceTheme,
  type SurfaceThemeSetting,
  type ThemeKey,
} from './themes';

/**
 * Set one surface's tokens on `root`, and its `data-theme` attribute to
 * `key`.
 *
 * `knownNames` is every token name this surface *could* hold (see
 * `APP_TOKEN_NAMES` and friends) — every one of them is either set to the
 * new theme's value or explicitly cleared, never merely left alone. Without
 * that, switching from a theme that sets a token (Newsprint's
 * `--print-decor-color`, say) to one that does not would leave the old
 * value stuck as a stale inline override on the root element, invisible
 * until the next full page load.
 */
export function applyTheme(
  root: HTMLElement,
  key: string,
  tokens: Readonly<Record<string, string>>,
  knownNames: readonly string[],
): void {
  root.dataset.theme = key;
  for (const name of knownNames) {
    const value = tokens[name];
    if (value === undefined) {
      root.style.removeProperty(name);
    } else {
      root.style.setProperty(name, value);
    }
  }
}

/** `applyTheme` for the App surface's root (see `appTheme.ts`). */
export function applyAppSurface(root: HTMLElement, key: ThemeKey, theme: SurfaceTheme): void {
  applyTheme(root, key, theme.tokens, APP_TOKEN_NAMES);
}

/** `applyTheme` for a Display surface root (`Observation.tsx`,
 *  `AwardCeremony.tsx`). */
export function applyDisplaySurface(root: HTMLElement, key: ThemeKey, theme: SurfaceTheme): void {
  applyTheme(root, key, theme.tokens, DISPLAY_TOKEN_NAMES);
}

/** `applyTheme` for the Printables surface root (`Printables.tsx`,
 *  `Certificate.tsx`, `HeatSheet.tsx`, `ResultsSheet.tsx`). */
export function applyPrintablesSurface(
  root: HTMLElement,
  key: ThemeKey,
  theme: SurfaceTheme,
): void {
  applyTheme(root, key, theme.tokens, PRINTABLES_TOKEN_NAMES);
}

/**
 * What `setting` actually resolves to.
 *
 * `'MATCH_APP'` is the stored sentinel behind the Display/Printables
 * pickers' default option (labelled "Field Uniform (default)" in
 * `ThemePicker.tsx` — see #528) — and it always resolves to Field Uniform.
 * The App theme lives only in each device's own `localStorage` and never
 * reaches the server (see `appTheme.ts`), so there is no "the App picker's
 * current value" that a wall display or a printed page could resolve
 * against even if the option's name once suggested there was; Field Uniform
 * is the one `ThemeKey` that is the same on every device. That is also why
 * Field Uniform's Display definition is exactly today's shipped
 * `.projector-mode` palette: an install that has never touched Settings
 * renders identically to before this feature existed.
 *
 * No caller passes anything else — the settings page's own live preview
 * (`AppearancePreview.tsx`) resolves Display/Printables exactly this way
 * too, so previewing the default shows what the wall and the printer will
 * actually render rather than a theme the preview alone could see (#528).
 */
export function resolveSurfaceKey(setting: SurfaceThemeSetting): ThemeKey {
  return setting === 'MATCH_APP' ? DEFAULT_THEME_KEY : setting;
}

/** The resolved Display theme for `setting` (see `resolveSurfaceKey`).
 *
 * `key` on the return value is the *validated* theme's own key — `themeByKey`
 * falls back to Field Uniform for a value from a build that no longer ships
 * it (or, on the server, a column nobody has ever written), and the `key`
 * returned here has to agree with `theme`, or a caller using it for
 * `data-theme` would tag the element with a key whose tokens are not the
 * ones actually applied. */
export function resolveDisplayTheme(setting: SurfaceThemeSetting): {
  key: ThemeKey;
  theme: SurfaceTheme;
} {
  const requested = resolveSurfaceKey(setting);
  const theme = themeByKey(requested);
  return { key: theme.key, theme: theme.display };
}

/** The resolved Printables theme for `setting` (see `resolveSurfaceKey` and
 *  `resolveDisplayTheme`'s note on why `key` is the validated theme's own). */
export function resolvePrintablesTheme(setting: SurfaceThemeSetting): {
  key: ThemeKey;
  theme: PrintablesSurfaceTheme;
} {
  const requested = resolveSurfaceKey(setting);
  const theme = themeByKey(requested);
  return { key: theme.key, theme: theme.printables };
}
