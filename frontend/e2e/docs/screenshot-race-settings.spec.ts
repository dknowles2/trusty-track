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
 * nav and what choosing a section does. Reached by the same `?edit=true`
 * link Home's row menu and Race Control's "Edit race" button use (#589).
 *
 * Race-scoped: it seeds its own race on the shared docs track and touches
 * nothing the other specs read.
 */

import { test, expect, settleTransitions } from './screenshots-setup';
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

    await page.goto(`/race/${raceId}?edit=true`);
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();
    // The Track / Timer field says "Loading tracks..." until the tracks query
    // answers, and whether the picture catches that depends on the run.
    await expect(dialog.getByText('Loading tracks...')).toBeHidden();

    await dialog.getByTestId('race-settings-nav-scoring').click();
    await expect(dialog.getByRole('heading', { name: 'Scoring' })).toBeVisible();
    await expect(dialog.getByLabel('Championship Trophies')).toBeVisible();
    // The nav's own background-color transition (see `settleTransitions`'s
    // doc comment) — without this, the picture sometimes shows "Event" and
    // "Scoring" mid-fade between the two states rather than settled.
    await settleTransitions(dialog);
    // `Modal.tsx`'s dialog element is itself the scrollable container
    // (`overflowY: 'auto'`), and nothing resets its `scrollTop` when the
    // section changes — so whatever the "Event" section's height happened to
    // leave it at carries over verbatim into "Scoring"'s taller layout. That
    // is a genuine scroll-position race, not a paint one: `dialog.click()`
    // on the nav button scrolls just enough of the *old* layout into view to
    // reach it, and Playwright does not know the content is about to grow.
    // Under load this sometimes left the picture scrolled a few dozen pixels
    // past the "Edit Race Details" heading — a materially different, and
    // materially wrong, picture, not a rendering nuance. Forced to a known
    // position rather than merely waited for, because there is no event to
    // wait *on*: nothing was ever going to scroll it back on its own.
    await dialog.evaluate((el) => {
        el.scrollTop = 0;
    });

    await dialog.screenshot({ path: path.join(SCREENSHOT_DIR, '11-edit-race-settings.png') });
});
