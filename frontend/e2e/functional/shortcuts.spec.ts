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
 *
 * Waits for Next Heat to be *enabled*, not merely visible (#1157) — the
 * button is always in the DOM now, disabled until the heat has a result
 * rather than absent before one, so `toBeVisible()` alone resolves the
 * instant the page loads and would let this helper return before the
 * fake-timer click has actually landed.
 */
async function runCurrentHeat(page: import('@playwright/test').Page) {
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    await expect(page.getByTestId('next-heat-button')).toBeEnabled({ timeout: 30000 });
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

test('the finish sound is offered, through Sound options, and remembered', async ({ page }) => {
    // The standalone "Finish sound" checkbox this spec used to check is gone
    // (#1074) — Sound options is the one control now, and the panel's own
    // "Heat Finish" row is what this test drives instead. The behaviour is
    // unchanged: off until somebody asks, and remembered on this device.
    //
    // Sound options (and the car-photo and auto-advance preferences below)
    // moved behind one ⚙ in the card header (#1157) — a popover, not a
    // control sitting directly on the row — so every lookup here opens it
    // first.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Chime Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    const preferencesTrigger = page.getByTestId('race-execution-preferences-trigger');
    await expect(preferencesTrigger).toBeVisible({ timeout: 30000 });
    await preferencesTrigger.click();
    const soundOptions = page.getByTestId('sound-effects-modal-trigger');
    await expect(soundOptions).toBeVisible();
    await soundOptions.click();

    const masterToggle = page.getByTestId('sound-master-toggle');
    // Off until somebody asks: a laptop that beeps unbidden in front of sixty
    // families is a worse first impression than silence.
    await expect(masterToggle).not.toBeChecked();

    await masterToggle.check();
    const finishToggle = page.getByTestId('sound-effect-finish');
    await expect(finishToggle).toBeChecked(); // On by default once master is.

    await page.getByRole('button', { name: 'Done' }).click();
    await page.reload();

    await page.getByTestId('race-execution-preferences-trigger').click();
    await page.getByTestId('sound-effects-modal-trigger').click();
    await expect(page.getByTestId('sound-master-toggle')).toBeChecked({ timeout: 30000 });
    await expect(page.getByTestId('sound-effect-finish')).toBeChecked();
});

test('the car-or-face photo preference is remembered on this device (#1075)', async ({ page }) => {
    // Per-device, the same shape as the sound settings above — this is the
    // one behaviour a unit test can't see: that the choice survives a
    // reload of this browser.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Shortcut Photo Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });

    // Behind the ⚙ popover (#1157).
    await page.getByTestId('race-execution-preferences-trigger').click();

    // The checkbox is visually hidden behind the pill, same as
    // `auto-advance-toggle` — click what the operator clicks.
    const photoToggle = page.getByTestId('lane-photo-toggle');
    // Car is the default (#1075) — the operator staging heats compares a
    // car in hand against a picture of a car, not a face.
    await expect(photoToggle).toBeChecked();

    await page.locator('label').filter({ has: photoToggle }).click();
    await expect(photoToggle).not.toBeChecked();
    await page.reload();

    await expect(page.getByTestId('race-execution-preferences-trigger')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('race-execution-preferences-trigger').click();
    await expect(page.getByTestId('lane-photo-toggle')).not.toBeChecked();
});
