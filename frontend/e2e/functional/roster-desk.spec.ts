/**
 * The three things the check-in desk does over and over (#202, #203, #204).
 *
 * The rules are unit-tested — `racerEntry.test.ts` for what carries over
 * between two hand-entered racers, `rosterSort.test.ts` for the order. What
 * only a real backend shows is that the roster page *reflects* them: the
 * second racer really is created, the sort really does survive the refetch
 * that every check-in triggers, and the counts come from the server rather
 * than from something the page tallied itself.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

test('save and add another keeps the racing group and clears the name', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Roster Desk Add Another Race');
    await gql(
        page,
        `mutation DeskRacingGroup($raceId: Int!, $racingGroup: RacingGroupInput!) { createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id } }`,
        { raceId, racingGroup: { name: 'Wolves', color: '#8B4513' } },
    );

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /^Add Racer$/ }).click();

    // Scoped to the form: the field's label — "Den" by default (#496) — also
    // sits inside the roster's "Group by Den" toggle, and "Name" matches the
    // search box's placeholder neighbourhood.
    const form = page.locator('form');
    const first = form.getByLabel('First Name');
    const last = form.getByLabel('Last Name');
    await first.fill('Gus');
    await last.fill('Gull');
    await form.getByLabel('Den', { exact: true }).selectOption({ label: 'Wolves' });
    await page.getByRole('button', { name: 'Save and add another' }).click();

    // Cleared for the next child, but still in the den we were working through.
    await expect(first).toHaveValue('');
    await expect(last).toHaveValue('');
    await expect(form.getByLabel('Den', { exact: true })).not.toHaveValue('');

    await first.fill('Hal');
    await last.fill('Hare');
    await page.getByRole('button', { name: 'Save Racer' }).click();

    // Scoped to the table: every racer is rendered twice, once as a row and
    // once as a mobile card that CSS hides.
    const rows = page.locator('.racer-row');
    await expect(rows.filter({ hasText: 'Gus' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Hal' })).toHaveCount(1);
});

test('the roster sorts by a column the operator picks', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Roster Desk Sorting Race');

    await page.goto(`/race/${raceId}`);

    const cells = page.locator('.racer-row td[data-label="Car #"]');
    const carNumbers = () => cells.allTextContents();

    // The default is car number ascending, which is what replaced the API's
    // insertion order.
    await expect(cells).toHaveCount(6);
    expect(await carNumbers()).toEqual(['1', '2', '3', '4', '5', '6']);

    await page.getByTestId('sort-car_number').getByRole('button').click();
    await expect(page.getByTestId('sort-car_number')).toHaveAttribute('aria-sort', 'descending');
    expect(await carNumbers()).toEqual(['6', '5', '4', '3', '2', '1']);
});

test('the sort survives the refetch a check-in triggers', async ({ page }) => {
    // Every check-in refetches the roster. A sort held anywhere the refetch
    // touches would snap back to the default half way through a queue. The
    // header's `aria-sort` is decorative state that can stay put while the
    // row order itself resets, so this reads the actual car-number cells —
    // the precise bug this test exists to catch.
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Roster Desk Sort Persists Race');

    await page.goto(`/race/${raceId}`);
    const cells = page.locator('.racer-row td[data-label="Car #"]');
    const carNumbers = () => cells.allTextContents();

    await page.getByTestId('sort-car_number').getByRole('button').click();
    await expect(page.getByTestId('sort-car_number')).toHaveAttribute('aria-sort', 'descending');
    expect(await carNumbers()).toEqual(['6', '5', '4', '3', '2', '1']);

    await gql(
        page,
        `mutation DeskUncheck($id: Int!) {
            checkInRacer(id: $id, passedInspection: false, weight: null) { id }
        }`,
        { id: racers[0].id },
    );

    await expect(page.getByTestId('check-in-progress')).toContainText('5 of 6 checked in');
    await expect(page.getByTestId('sort-car_number')).toHaveAttribute('aria-sort', 'descending');
    // Every racer stays on the roster regardless of check-in state, so the
    // full six rows must still read in the same descending order.
    expect(await carNumbers()).toEqual(['6', '5', '4', '3', '2', '1']);
});

test('the roster says how far check-in has got', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Roster Desk Progress Race');

    await gql(
        page,
        `mutation DeskUncheck2($id: Int!) {
            checkInRacer(id: $id, passedInspection: false, weight: null) { id }
        }`,
        { id: racers[0].id },
    );

    await page.goto(`/race/${raceId}`);

    await expect(page.getByTestId('check-in-progress')).toContainText('5 of 6 checked in');
});
