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
 * literally every commit. That is handled here, by hiding it.
 *
 * Import `test` and `expect` from this file rather than from `@playwright/test`.
 */

import { test as base, expect } from '@playwright/test';

/** Hidden rather than removed, so nothing reflows around the gap it leaves. */
const HIDE_UNSTABLE = `[data-testid="app-version"] { visibility: hidden !important; }`;

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
