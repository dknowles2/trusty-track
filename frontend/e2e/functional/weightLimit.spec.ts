/**
 * The pack's weight limit (#205).
 *
 * The rule is unit-tested in `weightCheck.test.ts`. What only a real backend
 * shows is that the limit *reaches* the check-in form — it is set on the race
 * and read by a different screen through a different query — and that it can
 * be turned back off, which needs an explicit control because `updateRace`
 * reads an absent field as "leave alone".
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

async function setLimit(page: import('@playwright/test').Page, raceId: number, oz: number) {
    await gql(
        page,
        `mutation SetLimit($id: Int!, $race: RaceUpdateInput!) {
            updateRace(id: $id, race: $race) { weightLimitOz }
        }`,
        { id: raceId, race: { weightLimitOz: oz } },
    );
}

test('check-in warns about a car over the limit', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Weight Limit Warning Race');
    await setLimit(page, raceId, 5);

    await page.goto(`/race/${raceId}`);
    await page
        .locator('.racer-row')
        .filter({ hasText: racers[0].lastName })
        .getByRole('button', { name: /Checked In|Check In/ })
        .click();

    const form = page.locator('form');
    await form.getByLabel('Car Weight (oz)').fill('5.4');

    await expect(page.getByTestId('weight-warning')).toContainText('Over the 5 oz limit');
});

test('an over-limit car can still be checked in', async ({ page }) => {
    // The inspector at the table decides. A laptop refusing the entry would
    // only mean the weight goes unrecorded.
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Weight Limit Override Race');
    await setLimit(page, raceId, 5);

    await page.goto(`/race/${raceId}`);
    await page
        .locator('.racer-row')
        .filter({ hasText: racers[0].lastName })
        .getByRole('button', { name: /Checked In|Check In/ })
        .click();

    const form = page.locator('form');
    await form.getByLabel('Car Weight (oz)').fill('5.4');
    await form.getByRole('button', { name: /Save/ }).click();

    await expect(form).toBeHidden();
    const stored = await gql<{ racer: { carWeight: number } }>(
        page,
        `query WeightBack($id: Int!) { racer(racerId: $id) { carWeight } }`,
        { id: racers[0].id },
    );
    expect(stored.racer.carWeight).toBe(5.4);
});

test('a race with no limit says nothing about weight', async ({ page }) => {
    // Which is every race created before this existed.
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Weight Limit Absent Race');

    await page.goto(`/race/${raceId}`);
    await page
        .locator('.racer-row')
        .filter({ hasText: racers[0].lastName })
        .getByRole('button', { name: /Checked In|Check In/ })
        .click();

    const form = page.locator('form');
    await form.getByLabel('Car Weight (oz)').fill('9.9');

    await expect(page.getByTestId('weight-warning')).toHaveCount(0);
});

test('the check can be turned off from the race form', async ({ page }) => {
    // `updateRace` reads an absent field as "leave alone", so without the
    // explicit control the check could be switched on and never off again.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Weight Limit Cleared Race');
    await setLimit(page, raceId, 5);

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /Edit Details/ }).click();

    const form = page.locator('form');
    // The edit form is sectioned (#587) and opens on Event; the weight check
    // is under "Check-in".
    await form.getByTestId('race-settings-nav-checkin').click();
    await form.getByLabel('Check car weights at inspection').uncheck();
    await form.getByRole('button', { name: /Save Changes/ }).click();
    await expect(form).toBeHidden();

    const after = await gql<{ race: { weightLimitOz: number | null } }>(
        page,
        `query LimitAfter($id: Int!) { race(raceId: $id) { weightLimitOz } }`,
        { id: raceId },
    );
    expect(after.race.weightLimitOz).toBeNull();
});
