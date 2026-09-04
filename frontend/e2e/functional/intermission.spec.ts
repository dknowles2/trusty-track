/**
 * A race-scoped break, started from Race Control and seen on the wall (#592).
 *
 * The rules are unit-tested on both sides: `test_domain_intermission.py` and
 * `test_intermission.py` for the backend, `intermission.test.ts` for the
 * countdown maths, `IntermissionControl.test.tsx` and
 * `IntermissionOverlay.test.tsx` for the two components in isolation. What
 * only a real backend and a real browser can show is the round trip: a
 * mutation the operator clicks reaching a *different* browser context's
 * observation page over the `race_state:{raceId}` subscription it already
 * holds, with no new socket — the same two-context shape `displays.spec.ts`
 * uses, because that is the actual situation on race day.
 */

import { test, expect, type Page } from '@playwright/test';
import { createSchedule, ensureConfigured, seedRace } from './support';

async function openDisplay(page: Page, raceId: number) {
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');
}

test('starting an intermission from Race Control shows the overlay on the wall', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Intermission Race');
    await createSchedule(page, raceId);

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId);

    // The wall shows the ordinary page until somebody calls a break.
    await expect(display.getByText('Now Racing')).toBeVisible({ timeout: 15000 });
    await expect(display.getByTestId('intermission-overlay')).toHaveCount(0);

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('intermission-control')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('intermission-preset-300').click();

    // No new socket: the same `race_state:{raceId}` subscription the wall
    // already holds carries the change.
    await expect(display.getByTestId('intermission-overlay')).toBeVisible({ timeout: 15000 });
    await expect(display.getByTestId('intermission-overlay-countdown')).toHaveText(/^[0-4]:\d\d$/);
    await expect(display.getByText('Now Racing')).toHaveCount(0);

    // Race Control's own control reflects it too, live.
    await expect(page.getByTestId('intermission-countdown')).toBeVisible();
    await expect(page.getByText('End now')).toBeVisible();

    // Pausing freezes the number on both screens.
    await page.getByText('Pause').click();
    await expect(page.getByText('Paused')).toBeVisible();
    await expect(display.getByText('Paused')).toBeVisible({ timeout: 15000 });

    // Ending it hands both screens back.
    await page.getByText('End now').click();
    await expect(page.getByTestId('intermission-control')).not.toContainText('End now');
    await expect(display.getByTestId('intermission-overlay')).toHaveCount(0, { timeout: 15000 });
    await expect(display.getByText('Now Racing')).toBeVisible();

    await displayContext.close();
});

test('extending adds time, visible on the wall', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Intermission Extend Race');
    await createSchedule(page, raceId);

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await page.getByTestId('intermission-preset-300').click();
    await expect(display.getByTestId('intermission-overlay')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('intermission-control').getByText('5 min').click();

    // 300s extended by 300s comfortably clears 5:00, where the un-extended
    // countdown never would.
    await expect(display.getByTestId('intermission-overlay-countdown')).toHaveText(/^[5-9]:\d\d$/, {
        timeout: 15000,
    });

    await displayContext.close();
});
