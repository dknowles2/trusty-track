/**
 * The App theme this device holds (#498).
 *
 * Per *device*, not per install — the opposite of Display and Printables,
 * which are columns on `Group` and so the same everywhere. This is a
 * personal preference about the screen in front of one person, costs
 * nothing to change, and never touches anything another device or a
 * printed page shows. Same shape as the operator PIN (`api/pin.ts`) and the
 * finish chime (`features/racing/chime.ts`): a `localStorage` key, wrapped
 * because storage throws rather than returning null in some browser
 * configurations, and a missing/garbled value must degrade to the default
 * theme, never to a screen that fails to render.
 */

import { applyAppSurface } from './applyTheme';
import { DEFAULT_THEME_KEY, THEME_KEYS, themeByKey, type ThemeKey } from './themes';

const STORAGE_KEY = 'trustytrack.appTheme';

function isThemeKey(value: string): value is ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(value);
}

/** The App theme this device has chosen, or Field Uniform if it has never
 *  chosen one (or the stored value is from a build that no longer ships
 *  it). */
export function readAppTheme(): ThemeKey {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isThemeKey(stored)) return stored;
  } catch {
    // Fall through to the default — nothing to break.
  }
  return DEFAULT_THEME_KEY;
}

export function writeAppTheme(key: ThemeKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Nothing to do about it, and nothing to break: the device simply keeps
    // reading the default on every load.
  }
}

/**
 * Apply this device's stored App theme to `root` — `document.body` by
 * default, "the top-level app wrapper" the spec calls it.
 *
 * Called as the very first statement in `main.tsx`, before
 * `ReactDOM.createRoot(...).render(...)`: that is what "before first paint"
 * means in a build with no static HTML shell to put an inline bootstrap
 * script in — the DOM mutation happens before React mounts a single node,
 * so there is nothing yet on screen for a themed background to visibly
 * replace.
 *
 * Also called on every Settings save that changes the App theme, so a
 * device applies its own new choice immediately rather than waiting for a
 * reload.
 */
export function applyStoredAppTheme(root: HTMLElement = document.body): void {
  const key = readAppTheme();
  applyAppSurface(root, key, themeByKey(key).app);
}
