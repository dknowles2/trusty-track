/**
 * What every documentation screenshot spec shares.
 *
 * Data directory cleanup is handled by the webServer command in
 * `playwright.screenshots.config.ts` so the clean happens before the backend
 * process starts, guaranteeing a fresh database on every run.
 *
 * The rest of this file exists to stop the images churning. A checked-in
 * screenshot that differs on every run is not a picture, it is a binary file
 * that rewrites itself: a change to one page rewrote roughly fifty of them,
 * and two branches touching the documentation conflicted on all fifty. Nothing
 * about that is visible in a diff, so it reads as noise rather than as a
 * problem with a cause.
 *
 * The data the app invents — the fake timer's lane times and the roster
 * `populateRace` makes up — is dealt with on the backend, by the
 * `TRUSTYTRACK_DEMO_SEED` the config sets. What is left is the version stamp
 * in the navigation bar, which is built from the git hash and so changes on
 * literally every commit, and the audience display's own id, which a fresh
 * Playwright browser profile mints a new UUID for on every run. Both are
 * handled here.
 *
 * The display id matters because #495's default name is *derived* from it
 * (`domain/display_names.whimsical_name`) — deterministic given the id, but
 * the id itself is not, so `observation/08-displays-panel.png` and
 * `11-ceremony-controls.png` would show a different animal every run without
 * this.
 *
 * Import `test` and `expect` from this file rather than from `@playwright/test`.
 */

import { test as base, expect } from '@playwright/test';

/** Hidden rather than removed, so nothing reflows around the gap it leaves. */
const HIDE_UNSTABLE = `[data-testid="app-version"] { visibility: hidden !important; }`;

/**
 * The key `displayIdentity.ts` reads and writes — kept in step with it here
 * rather than imported, since this file runs outside the app's build.
 */
const DISPLAY_ID_KEY = 'trustytrack.displayId';
/** Mirrors `FakeTimerMole`'s own key; the panel reads it on mount. */
const FAKE_TIMER_COLLAPSED_KEY = 'trustytrack.fakeTimerMole.collapsed';

/**
 * Fixed rather than left to mint itself, so the default name #495 derives
 * from it (`whimsical_name`) is the same animal on every run.
 */
const FIXED_DISPLAY_ID = 'trustytrack-docs-screenshot-display';

export const test = base.extend({
    page: async ({ page }, use) => {
        // An init script rather than `addStyleTag`, because the specs navigate
        // many times and a style added to one document does not survive the
        // next one. This runs on every document, before the app renders, so no
        // screenshot can catch the stamp on its way out.
        await page.addInitScript((css: string) => {
            const inject = () => {
                const style = document.createElement('style');
                style.setAttribute('data-screenshot-stability', '');
                style.textContent = css;
                document.head.appendChild(style);
            };
            if (document.head) inject();
            else document.addEventListener('DOMContentLoaded', inject);
        }, HIDE_UNSTABLE);

        // Seeded before the app ever asks `displayIdentity.displayId()` for
        // one, so it never mints its own UUID. `localStorage.setItem` is a
        // no-op the first time — nothing has navigated to the app's origin
        // yet — so this alone would not survive; `addInitScript` runs again
        // on every navigation, which is what makes it stick.
        await page.addInitScript(
            ({ key, id }: { key: string; id: string }) => {
                try {
                    window.localStorage.setItem(key, id);
                } catch {
                    // Some browser profiles refuse storage; the app already
                    // tolerates that (see `displayIdentity.ts`), and a
                    // screenshot spec that never opens a display panel does
                    // not care either way.
                }
            },
            { key: DISPLAY_ID_KEY, id: FIXED_DISPLAY_ID },
        );

        // The Fake Timer Controls panel starts collapsed in every docs run.
        //
        // Every race in these specs is on a fake timer, because no CI runner
        // has a finish line — so the panel floats over the corner of every
        // Race Control and Free Race screenshot, covering the lanes and the
        // round progress behind it. It is a debugging aid, and a reader of
        // these guides is looking at a screen that in their hall has a real
        // timer and no panel at all.
        //
        // Seeded rather than clicked, for #48's reason: the first attempt
        // collapsed it with a click in `race-day.spec.ts`, which fixed the one
        // picture somebody happened to be looking at and left the free-race
        // shots — and every future spec — exactly as they were. The panel
        // reads this key on mount, so setting it here reaches all of them.
        //
        // `race-day.spec.ts` expands it explicitly for the one screenshot that
        // is *of* the panel.
        await page.addInitScript((key: string) => {
            try {
                window.localStorage.setItem(key, 'true');
            } catch {
                // Storage refused: the panel opens expanded, which is only a
                // worse picture, never a failed run.
            }
        }, FAKE_TIMER_COLLAPSED_KEY);

        // Every screenshot waits for the pictures and freezes the animation.
        //
        // These two are what was left moving once the version stamp and the
        // invented data were pinned, and both were being handled by sleeping:
        // `waitForTimeout(500)` after opening a modal, `waitForTimeout(3000)`
        // after populating a roster. A sleep is a guess about a machine — too
        // short on a loaded CI runner, always too long on a fast laptop — and
        // it is why a run still rewrote a dozen images with nothing behind it.
        //
        // `animations: 'disabled'` fast-forwards CSS transitions to their end
        // state, so a modal is photographed where it is going to settle rather
        // than wherever it had got to. The image wait is a soft one: a page
        // with a genuinely broken image should produce the picture that shows
        // it, not a timeout with no picture at all.
        const takeScreenshot = page.screenshot.bind(page);
        page.screenshot = (async (options = {}) => {
            await page
                .waitForFunction(
                    () => Array.from(document.images).every((image) => image.complete),
                    undefined,
                    { timeout: 5000 },
                )
                .catch(() => {});
            return takeScreenshot({ animations: 'disabled', ...options });
        }) as typeof page.screenshot;

        // Playwright's fixture callback, not React's `use`. The lint rule
        // cannot tell them apart, and there is nothing to rename — the
        // parameter position is the API.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use(page);
    },
});

export { expect };

/**
 * A small, repeatable number in `[0, span)` for `key`.
 *
 * For a spec that needs its fake data to look unpatterned in a picture and to
 * be the same picture next time. `Math.random()` is what the specs used, and
 * it was the last thing making every standings, stats and observation image
 * differ on every run.
 *
 * FNV-1a: no cryptographic claim, only the two properties above.
 */
export function jitter(key: string, span = 0.05): number {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) / 4294967296) * span;
}
