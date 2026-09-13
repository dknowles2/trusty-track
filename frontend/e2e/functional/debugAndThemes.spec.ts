/**
 * Two settings the public demo could not change until #1079/#1080 split them
 * out of `updateInitialConfig`'s bundle: Debugging Mode and the Display theme.
 *
 * A demo-mode *backend* is not something this harness can stand up —
 * `webServer` in `playwright.config.ts` starts one ordinary instance
 * unconditionally, established while building #1100's `demoRefusedMutations`.
 * What a real backend and a real browser *can* show, off the demo, is the
 * two seams the split was built around:
 *
 * - the Advanced checkbox actually reaches `setDebugMode`, and the timer
 *   debug panel it unlocks renders for the fake timer these specs all use —
 *   the one debug view a `FAKE` track (the demo's own) has anything to show
 *   on at all, since the hardware mole needs a real device's bytes;
 * - the Display picker actually reaches `setThemes`, and an already-open
 *   Observation page re-themes over the `displayAssignment` subscription
 *   with no reload — #586's promise, and the one part a unit test cannot see.
 *
 * Both settings are install-wide, shared with every other spec in this run,
 * so each test restores its own change on the way out.
 */

import { expect, test } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, seedRace } from './support';

test('turning on Debugging Mode shows the timer state-machine transitions panel once a heat is armed', async ({
    page,
}) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Debug Mode Transitions Race');
    await createSchedule(page, raceId);

    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-advanced').click();
    await page.getByLabel('Debugging Mode').check();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();

    const persisted = await gql<{ initialConfig: { debugMode: boolean } }>(
        page,
        `query { initialConfig { debugMode } }`,
    );
    expect(persisted.initialConfig.debugMode).toBe(true);

    try {
        await page.goto(`/race/${raceId}/control/race`);

        // The heat arms itself (raceFlow.ts's auto-prepare) once the Race
        // tab is showing a heat with a timer behind it.
        await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });

        // The panel every timer type can show, unlike the hardware mole —
        // it reads the state machine's own history, not a device's bytes,
        // so a FAKE track (the one this whole suite runs on) has something
        // for it to display.
        const panel = page.getByTestId('timer-transitions-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByText('ARMED')).toBeVisible();
    } finally {
        // Shared, install-wide state (#1079) — leave it as this run found it.
        await page.goto('/system-settings');
        await page.getByTestId('settings-nav-advanced').click();
        await page.getByLabel('Debugging Mode').uncheck();
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await expect(page.getByText('Settings saved')).toBeVisible();
    }
});

test('picking Under the Lights for the Display theme re-themes an open Observation page with no reload', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Display Theme Broadcast Race');

    // The display and the operator are different machines, and a display
    // holds no PIN — the same two-context shape `displays.spec.ts` uses.
    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await display.goto(`/race/${raceId}/observation`);
    await display.waitForLoadState('networkidle');

    // The install's own default, confirmed before changing it — the
    // assertion below is meaningless if this was already the theme.
    await expect(display.locator('.container[data-theme="field-uniform"]').first()).toBeVisible();

    try {
        await page.goto('/system-settings');
        await page.getByTestId('settings-nav-appearance').click();
        await page.getByTestId('display-theme-option-under-the-lights').click();
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await expect(page.getByText('Settings saved')).toBeVisible();

        // No reload on the display's side at all — `setThemes` nudges the
        // `displayAssignment` subscription every open screen already holds
        // (#586), and the theme attribute flips on the same page load.
        await expect(
            display.locator('.container[data-theme="under-the-lights"]').first(),
        ).toBeVisible({ timeout: 15000 });
    } finally {
        await page.goto('/system-settings');
        await page.getByTestId('settings-nav-appearance').click();
        await page.getByTestId('display-theme-option-MATCH_APP').click();
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await expect(page.getByText('Settings saved')).toBeVisible();
        await displayContext.close();
    }
});
