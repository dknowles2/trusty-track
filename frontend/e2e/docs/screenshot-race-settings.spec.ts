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

import { test, expect, screenshotLocator, settleTransitions } from './screenshots-setup';
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
    // Asserted, not assumed: the picture's caption says the nav shows Scoring
    // active, so check that it actually does before spending any more time
    // settling paint. `section` is plain React state set synchronously by the
    // click handler — there is no scroll-spy in this form, whatever an
    // earlier read of this flake believed — so this never legitimately fails;
    // it exists to fail loudly rather than let a real regression here read as
    // a screenshot problem.
    await expect(dialog.getByTestId('race-settings-nav-scoring')).toHaveAttribute('aria-current', 'page');
    // The nav's own background-color transition (see `settleTransitions`'s
    // doc comment) — without this, the picture sometimes shows "Event" and
    // "Scoring" mid-fade between the two states rather than settled.
    await settleTransitions(dialog);
    // `Modal.tsx`'s dialog element is itself the scrollable container
    // (`overflowY: 'auto'`). Nothing resets its `scrollTop` when the section
    // changes, so this is cheap insurance against the same class of drift
    // `race-day/02-check-in-modal-inspected.png` hit — but it is not what
    // caused this picture's own flake: instrumenting a real run shows
    // `scrollTop` sits at `0` throughout, here, every time. What actually
    // moves under this click is `Modal.tsx`'s own centring — the backdrop's
    // `alignItems: 'center'` re-centres the dialog when "Scoring" (much
    // taller than "Event") changes its height, carrying the nav upward under
    // Playwright's still pointer with no scroll involved at all, and leaving
    // whichever item ends up under it genuinely `:hover`-ed. `screenshotLocator`
    // below is where that is actually closed (#970: see its own doc comment).
    await dialog.evaluate((el) => {
        el.scrollTop = 0;
    });

    // `screenshotLocator`, not `dialog.screenshot()` — this dialog capture
    // needs the same pointer-park `page.screenshot()` gets, and gets it from
    // nowhere else (#970: see that helper's own doc comment).
    await screenshotLocator(dialog, { path: path.join(SCREENSHOT_DIR, '11-edit-race-settings.png') });
});
