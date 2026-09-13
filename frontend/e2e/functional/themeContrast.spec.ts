/**
 * Under the Lights actually renders the Round Wizard readably (#1060).
 *
 * `themes.test.ts` pins the *token values* in isolation, but the bug this
 * closes was never about the token map disagreeing with itself — it was
 * three token families (`--wizard-*`, `--warning-notice-*`, `--caution-*`)
 * carrying Field Uniform's light-mode literals into every theme, Under the
 * Lights included, with a fully green unit suite throughout. Nothing in
 * this tree drove a themed screen through a real browser before this file:
 * that is the seam (#1025 names it as "theme x wizard"). This spec is the
 * one place that actually applies the theme, opens the Round Wizard, and
 * reads back the computed color the browser paints — the only check that
 * would have caught the token map being internally consistent and visually
 * wrong (dark text quietly matched to a `--surface-color` this theme
 * defines as dark, say).
 */

import { expect, test } from '@playwright/test';
import { seedRace } from './support';

// The App theme lives in this device's own localStorage (`appTheme.ts`),
// never on the server — so it has to be written before the app boots
// (`applyStoredAppTheme` runs as the very first statement in `main.tsx`),
// not after navigating to a page that has already applied Field Uniform's
// default.
async function useUnderTheLights(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem('trustytrack.appTheme', 'under-the-lights');
    });
}

test('the Round Wizard reads under Under the Lights: a field label and a step heading both clear the dark surface', async ({
    page,
}) => {
    await useUnderTheLights(page);

    const { raceId } = await seedRace(page, 'Theme Contrast Wizard');

    await page.goto(`/race/${raceId}/control/schedule`);
    await page.waitForLoadState('networkidle');

    // A fresh race has no rounds yet, so the schedule tab offers the
    // wizard's own entry point rather than a list of rounds.
    await page.getByRole('button', { name: 'Start Round Creation Wizard' }).click();

    // Step 1 (Qualifying Rounds): "Runs per lane" is an ordinary field
    // label, styled from `labelStyle`'s `--wizard-text-color` — this is
    // the token the issue measured at 1.55:1 against this theme's own
    // `--surface-color` (#1c222c) before the fix, using Field Uniform's
    // `#374151`. It now reads `#cfd6e0` (rgb(207, 214, 224)), ~10.9:1.
    const runsPerLaneLabel = page.locator('label', { hasText: 'Runs per lane' }).first();
    await expect(runsPerLaneLabel).toBeVisible();
    const labelColor = await runsPerLaneLabel.evaluate((el) => getComputedStyle(el).color);
    expect(labelColor).toBe('rgb(207, 214, 224)');
    expect(labelColor).not.toBe('rgb(55, 65, 81)'); // Field Uniform's #374151, the pre-fix value.

    // Step 2 (Championships): "Championship Rounds" is a step heading,
    // styled from `--wizard-heading-color` — measured at 1.11:1 before the
    // fix, using Field Uniform's `#111827`. It now reads `#eef1f6`
    // (rgb(238, 241, 246)), ~14.1:1 — the same value this theme's own
    // `--text-color` already uses against the identical surface.
    await page.getByRole('button', { name: 'Next' }).click();
    const championshipHeading = page.getByRole('heading', { name: 'Championship Rounds' });
    await expect(championshipHeading).toBeVisible();
    const headingColor = await championshipHeading.evaluate((el) => getComputedStyle(el).color);
    expect(headingColor).toBe('rgb(238, 241, 246)');
    expect(headingColor).not.toBe('rgb(17, 24, 39)'); // Field Uniform's #111827, the pre-fix value.
});
