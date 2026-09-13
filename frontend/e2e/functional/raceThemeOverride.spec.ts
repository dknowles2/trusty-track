/**
 * A race's own Display/Printables theme override (#1081).
 *
 * `Organization.display_theme`/`printables_theme` (#498, `setThemes` per
 * #1080) already choose these install-wide, and `debugAndThemes.spec.ts`
 * covers that install-wide broadcast reaching every open display regardless
 * of race. This is the narrower, race-scoped layer on top: a race's own
 * override reaches only the displays already pointed at *that* race
 * (`_publish_race_display_theme_change`, the sibling of
 * `_broadcast_display_theme_change`), and a printed page for the race reads
 * the identical resolved value (`Race.resolvedPrintablesTheme`).
 *
 * Each race here is this spec's own — nothing here touches the
 * install-wide setting, so there is nothing to restore on the way out.
 */

import { expect, test } from '@playwright/test';
import { seedRace } from './support';

test('a race’s own Display theme reaches only an open Observation page for that race, and clearing it reverts to the install’s', async ({
    browser,
    page,
}) => {
    const { raceId: raceIdA } = await seedRace(page, 'Rocket Derby (theme override)');
    const { raceId: raceIdB } = await seedRace(page, 'Ordinary Derby (theme override)');

    // The displays and the operator are different machines — the same
    // two-context shape `debugAndThemes.spec.ts` and `displays.spec.ts` use.
    const displayContext = await browser.newContext();
    const displayA = await displayContext.newPage();
    await displayA.goto(`/race/${raceIdA}/observation`);
    await displayA.waitForLoadState('networkidle');
    await expect(displayA.locator('.container[data-theme="field-uniform"]').first()).toBeVisible();

    const displayB = await displayContext.newPage();
    await displayB.goto(`/race/${raceIdB}/observation`);
    await displayB.waitForLoadState('networkidle');
    await expect(displayB.locator('.container[data-theme="field-uniform"]').first()).toBeVisible();

    try {
        await page.goto(`/race/${raceIdA}`);
        await page.getByRole('button', { name: 'Edit race' }).click();
        let dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
        await expect(dialog).toBeVisible();

        // The edit form is sectioned (#587) and opens on Event; the override
        // is under Appearance.
        await dialog.getByTestId('race-settings-nav-appearance').click();
        await dialog.getByTestId('race-display-theme-option-under-the-lights').click();
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(dialog).toBeHidden();

        // Race A's own open display re-themes with no reload — #586's
        // promise, now for a race's own override rather than the
        // install-wide setting `debugAndThemes.spec.ts` already covers.
        await expect(
            displayA.locator('.container[data-theme="under-the-lights"]').first(),
        ).toBeVisible({ timeout: 15000 });

        // Race B's display was never pointed at race A, so it must not have
        // heard anything at all — still the install's own Field Uniform.
        await expect(
            displayB.locator('.container[data-theme="field-uniform"]').first(),
        ).toBeVisible();

        // Clearing the override goes back to "Use the install's setting" —
        // still Field Uniform here, since nothing in this run has touched
        // System Settings' own Display theme.
        await page.getByRole('button', { name: 'Edit race' }).click();
        dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
        await expect(dialog).toBeVisible();
        await dialog.getByTestId('race-settings-nav-appearance').click();
        await dialog.getByTestId('race-display-theme-option-INHERIT').click();
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(dialog).toBeHidden();

        await expect(
            displayA.locator('.container[data-theme="field-uniform"]').first(),
        ).toBeVisible({ timeout: 15000 });
    } finally {
        await displayContext.close();
    }
});

test('a race’s own Printables theme renders on its pit passes', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Printables Theme Override Race');

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: 'Edit race' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('race-settings-nav-appearance').click();
    await dialog.getByTestId('race-printables-theme-option-newsprint').click();
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden();

    await page.goto(`/race/${raceId}/print?kind=pit-pass`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.printables-page[data-theme="newsprint"]').first()).toBeVisible();
});
