/**
 * A screenshot of the race edit form, for docs/reference/race-settings.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-race-settings.spec.ts
 *
 * The form is sectioned while editing (#587) — one section at a time with a
 * nav down the left — and the reference page describes it section by
 * section, so the picture shows the dialog with a section other than the
 * first one up: Scoring, the one that grew most, so a reader sees both the
 * nav and what choosing a section does.
 *
 * Race-scoped: it seeds its own race on the shared docs track and touches
 * nothing the other specs read.
 *
 * --- The history of this one image (#970) ---
 *
 * This capture used to reach Scoring by opening the dialog on its default
 * section and then clicking the nav — and that click was the entire
 * problem, diagnosed and re-diagnosed three times across #972 and #986
 * before the fix was to stop doing it rather than to chase the click's
 * consequences further. Clicking into "Scoring" (much taller than "Event")
 * grows the dialog, `Modal.tsx`'s `alignItems: 'center'` backdrop re-centres
 * it in response, and that carries the nav *upward* under Playwright's still
 * pointer — landing whichever item ends up there in a genuine, un-asked-for
 * `:hover`. #972 parked the pointer off-viewport after the click; #986 found
 * that the parking itself raced a real, asynchronous Chromium hit-test
 * recompute and added a poll (`screenshotLocator`'s own `:hover` wait,
 * below) to wait for it rather than assume two frames was enough. Both
 * fixes were real and each lowered the failure rate — roughly 1 in 3, then
 * roughly 1 in 25 — without reaching zero, because neither touched the
 * cause: a screenshot spec that grows a dialog and moves a pointer over it
 * has an unbounded number of ways to be caught mid-consequence.
 *
 * The fix here removes the growth instead of chasing its effects: `?section=
 * scoring` on the same `?edit=true` link (`RaceForm`'s own `initialSection`
 * prop) opens the dialog straight onto Scoring, so there is no click on this
 * page at all, and so nothing for the class of flake above to happen to —
 * the dialog never grows after it is first painted, `Modal.tsx` never
 * re-centres it, and the pointer (parked off-viewport by every earlier step
 * in this spec, and never brought back on screen) never approaches the nav
 * in the first place. `screenshotLocator` is kept for the capture itself
 * (#972) — it still does the image/font wait a locator screenshot needs and
 * still parks the pointer and waits out any `:hover` before capturing — but
 * none of that is now covering for anything this spec's own click used to
 * cause, since this spec no longer clicks anything.
 */

import { test, expect, screenshotLocator } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, seedRace } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-setup');

test('screenshot the race settings form', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);
    const raceId = await seedRace(page, {
        name: 'Pack 42 Settings Derby',
        trackId: await docsTrackId(page),
        dateTime: '2026-03-14T09:30:00',
        location: 'School Gym',
    });

    // Straight onto Scoring — no click on this page at all. See this file's
    // own header comment for why that is the fix, not merely a shortcut.
    await page.goto(`/race/${raceId}?edit=true&section=scoring`);
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();
    // The Track / Timer field says "Loading tracks..." until the tracks query
    // answers, and whether the picture catches that depends on the run.
    await expect(dialog.getByText('Loading tracks...')).toBeHidden();
    await expect(dialog.getByRole('heading', { name: 'Scoring' })).toBeVisible();
    await expect(dialog.getByLabel('Championship Trophies')).toBeVisible();
    // Asserted, not assumed: the picture's caption says the nav shows Scoring
    // active, so check that it actually does before capturing. This can only
    // fail if `initialSection` itself stops working — there is no click here
    // for a stale state to survive, and no scroll-spy in this form.
    await expect(dialog.getByTestId('race-settings-nav-scoring')).toHaveAttribute('aria-current', 'page');

    await screenshotLocator(dialog, { path: path.join(SCREENSHOT_DIR, '11-edit-race-settings.png') });
});
