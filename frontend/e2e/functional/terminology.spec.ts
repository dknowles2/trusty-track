/**
 * Renaming the words reaches a race page already open, without a reload
 * (issue #531).
 *
 * `RaceTerminologyGate` (`App.tsx`) reads `Race.terminology` under the
 * default `cache-first` policy, so a page that already holds the answer
 * only follows a rename if the mutation that changed it teaches the
 * normalized cache the new value — either by writing it directly, or by
 * invalidating what it can no longer vouch for. That agreement between a
 * mutation and a query is exactly what `graphqlClient.test.ts` characterises
 * against a stub network layer; this is the same rule against a real
 * backend, a real browser and the roster page's own rendering of the word.
 *
 * Only the per-race override (route 1 in the issue) is covered here, not
 * the organization default (route 2). The organization's terminology is
 * install-wide state, and this suite runs `fullyParallel` against one
 * backend (`playwright.config.ts`) — renaming it here would rename it out
 * from under `roster.spec.ts` and `roster-desk.spec.ts`, which assume the
 * built-in "Den" while they run alongside this file. That is the same
 * reason `screenshot-settings.spec.ts` documents for never clicking Save on
 * the organization's terminology fields. Route 2 has its own coverage in
 * `graphqlClient.test.ts` instead, against the real cache configuration.
 */

import { test, expect } from '@playwright/test';
import { seedRace } from './support';

test('a per-race terminology change updates the roster column without a reload', async ({
    page,
}) => {
    const race = await seedRace(page, 'Terminology Race');

    await page.goto(`/race/${race.raceId}`);

    // The organization default, inherited: no override has been set yet.
    const column = page.getByTestId('sort-racingGroup');
    await expect(column).toHaveText('Den');

    await page.getByRole('button', { name: 'Edit Details' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Use different words for this race').click();
    // "More than one" is not unique — the same label text is used for both
    // the racing group and the organization's own plural — so these two are
    // found by id rather than by label text.
    await dialog.locator('#race-racing-group-singular').fill('Class');
    await dialog.locator('#race-racing-group-plural').fill('Classes');

    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden();

    // No navigation and no reload between the save above and this assertion
    // — `RaceTerminologyGate` has held the same subscription to
    // `Race.terminology` throughout, so this is the cache picking up the new
    // value on its own rather than a fresh page rendering it fresh.
    await expect(column).toHaveText('Class');
});
