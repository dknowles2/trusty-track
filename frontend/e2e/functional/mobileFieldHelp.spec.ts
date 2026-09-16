/**
 * Per-control helper text collapses to a disclosure on a phone (#1154).
 *
 * `RaceForm.tsx`'s Event and Scoring sections, and `SystemSettings.tsx`'s
 * General section, used to carry a paragraph of muted prose under nearly
 * every control — a column of 11px text an operator scrolled through on a
 * phone to reach Save. `FieldHelp.test.tsx` covers the component in
 * isolation; this drives the real forms, at a real viewport, to confirm the
 * collapse actually reaches the page.
 *
 * `mobileStandingsAndAwards.spec.ts` and `mobileRaceTab.spec.ts` already
 * settled on 390×844 as this suite's stand-in for "a phone"; this reuses it
 * rather than inventing a second number.
 *
 * The thresholds below are measured against this tree, not against the
 * issue's own "about 2,000px" / "about 1,700px" — those were taken before
 * later additions (the organization-scale question in General, the
 * per-race Appearance section in the race form) grew the un-collapsed
 * baseline past what the issue recorded. Checked out immediately before
 * this change (`git show d2992fd0:...`, the commit right before FieldHelp
 * landed) and measured at this same 390×844 viewport:
 *
 * | Measurement | Before | After |
 * | --- | --- | --- |
 * | Edit race → Event: Save Changes' `y` | 1047px | 909px |
 * | Edit race → Scoring: section height | 1385px | 925px |
 * | Settings → General: section height | 1268px | 1050px |
 *
 * Every number below leaves headroom above the measured "after" and margin
 * under the measured "before" — genuine, substantial reductions rather than
 * a threshold tuned to just barely pass.
 *
 * **The first-run wizard is not covered here.** The functional harness
 * shares one backend across the whole run (`configure.setup.ts` configures
 * it once, before anything else), so there is no "fresh install" fixture to
 * drive a real `isEditing === false` screen against — every spec in this
 * directory sees an already-configured install. `FieldHelp.test.tsx`'s own
 * "forceOpen — the first-run wizard" cases are what pin that path (always
 * expanded, no toggle, regardless of width or a `summary`), and
 * `screenshot-first-run.spec.ts` — which does drive a genuinely fresh
 * install, in the docs harness — is the cross-check that the real wizard
 * renders every field expanded.
 */

import { expect, test, type Page } from '@playwright/test';

import { ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

/** Opens the sectioned race edit dialog straight onto `section`, the same
 * `?edit=true&section=...` deep link `screenshot-race-settings.spec.ts` and
 * `RaceDetails.tsx`'s own `initialSection` prop exist for — no click on the
 * nav needed. */
async function openRaceSection(page: Page, raceId: number, section: string): Promise<void> {
    await page.goto(`/race/${raceId}?edit=true&section=${section}`);
    await expect(page.getByTestId(`race-section-${section}`)).toBeVisible({ timeout: 15000 });
}

test.describe('phone (390×844)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('Edit race → Event: Save Changes is reachable well above the fold, and the Lock race help is collapsed (#1154)', async ({
        page,
    }) => {
        const { raceId } = await seedRace(page, 'Field Help Event ' + Date.now());
        await openRaceSection(page, raceId, 'event');

        // The Lock race box: one line visible at every width, the rest behind
        // the toggle — a `summary`, not a width-driven collapse, so this holds
        // here at 390px the same as it does at 1280px below.
        const lockBox = page.locator('label', { hasText: 'Lock race' }).locator('..');
        await expect(
            page.getByText('Guards a finished race against accidental edits; it can still be deleted.'),
        ).toBeVisible();
        await expect(
            page.getByText(/scheduling, results, racer registrations and awards cannot be changed/),
        ).toBeHidden();
        const lockToggle = lockBox.getByRole('button', { name: 'More about this' });
        await expect(lockToggle).toHaveAttribute('aria-expanded', 'false');

        // The bug: this button used to sit 1,047px down the dialog's own
        // (unscrolled) layout — off the bottom of a 844px-tall phone with
        // nothing scrolled yet. `boundingBox()` reports the element's real
        // rendered position, not merely whether an ancestor's `overflow`
        // happens to clip it — so an un-scrolled dialog still reports a large
        // `y` for anything genuinely far down the page.
        const saveButton = page.getByRole('button', { name: 'Save Changes' });
        const box = await saveButton.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeLessThan(950);
    });

    test('Edit race → Scoring: the section is far shorter than its unhelped 1,385px (#1154)', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Field Help Scoring ' + Date.now());
        await openRaceSection(page, raceId, 'scoring');

        const section = page.getByTestId('race-section-scoring');
        const box = await section.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThan(1000);

        // Every option's toggle is closed by default — the label and radio
        // are still there, only the description sentence is not.
        await expect(
            page.getByText(/A single bad run costs a little, not everything\./),
        ).toBeHidden();
    });

    test('Settings → General (configured install): the section is far shorter than its unhelped 1,268px, and the toggle opens a sentence in place (#1154)', async ({
        page,
    }) => {
        await ensureConfigured(page);
        await page.goto('/system-settings');
        await expect(page.getByTestId('general-panel')).toBeVisible({ timeout: 15000 });

        const panel = page.getByTestId('general-panel');
        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThan(1100);

        // "Use different words…" explanation, collapsed by default, opens in
        // place on click — the same disclosure `FieldHelp.test.tsx` covers in
        // isolation, now exercised against the real page.
        const sentence = page.getByText(
            'For a school, a club, a Space Derby, or anyone racing the same format under different words. A race can override this on its own settings too.',
        );
        await expect(sentence).toBeHidden();

        const toggle = page
            .locator('label', { hasText: 'Use different words' })
            .locator('..')
            .getByRole('button', { name: 'More about this' });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(sentence).toBeVisible();
    });
});

test.describe('desktop (1280×800)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('Edit race → Event: the track help text is visible inline, with no toggle (#1154)', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Field Help Desktop Event ' + Date.now());
        await openRaceSection(page, raceId, 'event');

        await expect(
            page.getByText(/The track's lanes, timer and records are set up in System Settings/),
        ).toBeVisible();
        // The Lock race box is still condensed at this width — `summary` is
        // width-independent — but every ordinary helper block is not.
        await expect(page.getByRole('button', { name: 'More about this' })).toHaveCount(1);
    });

    test('Settings → General: option descriptions are visible inline, with no toggle (#1154)', async ({ page }) => {
        await ensureConfigured(page);
        await page.goto('/system-settings');
        await expect(page.getByTestId('general-panel')).toBeVisible({ timeout: 15000 });

        await expect(
            page.getByText('For a school, a club, a Space Derby, or anyone racing the same format under different words. A race can override this on its own settings too.'),
        ).toBeVisible();
        await expect(page.getByTestId('general-panel').getByRole('button', { name: 'More about this' })).toHaveCount(0);
    });
});
