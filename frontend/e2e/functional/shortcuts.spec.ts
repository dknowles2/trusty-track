/**
 * Keys the race control operator can reach without the mouse (#207).
 *
 * The rules are unit-tested and the wiring has component tests. What only a
 * real backend shows is that a keystroke moves the *race*: advancing is a
 * mutation plus a subscription payload plus a re-render, and a shortcut that
 * fires the handler without any of that happening would pass every test above.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, seedRace } from './support';

/**
 * Run the heat the screen is showing, through the fake timer.
 *
 * Recording it through the API instead lands the operator on the *next* heat:
 * the fallback is "the first heat still to be run", so a heat recorded before
 * the page loads is one the page never selects. Running it here leaves the
 * screen pinned to the heat that just finished (#130), which is the state
 * these keys are for.
 */
async function runCurrentHeat(page: import('@playwright/test').Page) {
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    await expect(page.getByRole('button', { name: /^Next Heat/ })).toBeVisible({ timeout: 30000 });
}

test('Space moves to the next heat', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Advance Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await runCurrentHeat(page);

    const heading = page.getByRole('heading', { name: /^Heat \d+$/ });
    await expect(heading).toHaveText('Heat 1');

    await page.keyboard.press(' ');

    await expect(heading).toHaveText('Heat 2', { timeout: 15000 });
});

test('E opens the result editor', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Edit Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await runCurrentHeat(page);

    await page.keyboard.press('e');

    await expect(page.getByRole('dialog', { name: /Edit Results/ })).toBeVisible();
});

test('typing an e into the editor does not reopen it', async ({ page }) => {
    // The guard that matters most: the operator is correcting a time with the
    // dialog open, and every key they press is meant for the field.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Typing Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await runCurrentHeat(page);
    await page.keyboard.press('e');

    const dialog = page.getByRole('dialog', { name: /Edit Results/ });
    await expect(dialog).toBeVisible();
    const heading = page.getByRole('heading', { name: /^Heat \d+$/ });
    await expect(heading).toHaveText('Heat 1');

    // Space with the dialog up must not advance the race underneath it.
    await page.keyboard.press(' ');

    await expect(dialog).toBeVisible();
    await expect(heading).toHaveText('Heat 1');
});

test('the finish sound is offered and remembered', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Chime Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    const toggle = page.getByTestId('finish-chime-toggle');
    await expect(toggle).toBeVisible({ timeout: 30000 });
    // Off until somebody asks: a laptop that beeps unbidden in front of sixty
    // families is a worse first impression than silence.
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await page.reload();

    await expect(page.getByTestId('finish-chime-toggle')).toBeChecked({ timeout: 30000 });
});
