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

        // #1244: on a FAKE track the panel is the readout for the fake
        // timer's own Start Timer/Finish Heat controls, so it docks
        // directly under them rather than at the foot of the right column
        // under On Deck. Checked at desktop width and again on a phone
        // viewport, where the grid concatenates left-then-right and the
        // fake-timer stack must stay together rather than the panel
        // falling to the very end of the page.
        for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await expect(panel).toBeVisible();

            // Two sequential `boundingBox()` round trips read the layout on
            // either side of a gap the app's own subscriptions (the
            // WebSocket log above shows several reconnecting around this
            // point) can land a re-render inside, which is what made this
            // flaky the first time it ran twice — one read would land on the
            // heat card mid-reflow. `waitForFunction` first settles the
            // layout (there is nothing left in this app that would move the
            // panel once it does), then one atomic `evaluate` takes every
            // measurement in a single, uninterruptible browser turn.
            await page.waitForFunction(
                () => {
                    const moleEl = document.querySelector('[data-testid="fake-timer-mole"]');
                    const panelEl = document.querySelector('[data-testid="timer-transitions-panel"]');
                    if (!moleEl || !panelEl) return false;
                    const m = moleEl.getBoundingClientRect();
                    const p = panelEl.getBoundingClientRect();
                    return p.top >= m.bottom - 1;
                },
                undefined,
                { timeout: 5000 },
            );

            const layout = await page.evaluate(() => {
                const moleEl = document.querySelector('[data-testid="fake-timer-mole"]') as HTMLElement;
                const panelEl = document.querySelector('[data-testid="timer-transitions-panel"]') as HTMLElement;
                const onDeckEl = document
                    .querySelector('[data-testid="race-execution-right-column"]')
                    ?.querySelector('h3');
                const m = moleEl.getBoundingClientRect();
                const p = panelEl.getBoundingClientRect();
                return {
                    panelTop: p.top,
                    panelLeft: p.left,
                    moleBottom: m.bottom,
                    moleLeft: m.left,
                    // DOCUMENT_POSITION_FOLLOWING is 4.
                    onDeckFollowsPanel: onDeckEl
                        ? (panelEl.compareDocumentPosition(onDeckEl) & 4) !== 0
                        : false,
                };
            });

            expect(layout.panelTop).toBeGreaterThanOrEqual(layout.moleBottom);
            expect(Math.abs(layout.panelLeft - layout.moleLeft)).toBeLessThanOrEqual(2);
            // The panel is not the last thing on the page — On Deck, from
            // the right column, still follows it in document order.
            expect(layout.onDeckFollowsPanel).toBe(true);
        }
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
