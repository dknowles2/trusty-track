/**
 * The race the operator last looked at, remembered per device (#959).
 *
 * Leaving a race for an install page — Settings, Timer check, Activity —
 * used to drop every trace of which race the operator came from: the pill
 * read "Select a Race" the same as it does on Home, and the only way back
 * was the pill's own dropdown or the browser's Back button. Each of the
 * three pages found its own way back differently, or not at all.
 *
 * Stored per *device*, the same shape as the operator PIN (`api/pin.ts`),
 * the App theme (`theming/appTheme.ts`) and the finish chime
 * (`features/racing/chime.ts`): a `localStorage` key, wrapped because
 * storage throws rather than returning null in some browser configurations,
 * and a missing or garbled value must degrade to "no race remembered",
 * never to a screen that fails to render.
 *
 * `Navigation.tsx` writes this on every race-scoped route it renders, and
 * clears it when `racesChanged` reveals the remembered race no longer
 * exists — `readLastRace` itself never validates that the race is still
 * there, since it holds no database connection of its own. `BackLink` is
 * the one place this is read back.
 */

const STORAGE_KEY = 'trustytrack.lastRace';

export interface RememberedRace {
  id: number;
  name: string;
}

function isRememberedRace(value: unknown): value is RememberedRace {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as RememberedRace).id === 'number' &&
    typeof (value as RememberedRace).name === 'string'
  );
}

/** The race the operator last had open, or null if none is remembered (or
 *  the stored value is from a build that shaped it differently). */
export function readLastRace(): RememberedRace | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isRememberedRace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastRace(race: RememberedRace): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(race));
  } catch {
    // Nothing to do about it, and nothing to break: the device simply keeps
    // showing "Select a Race" on the install pages instead of a name.
  }
}

export function clearLastRace(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}
