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
 *
 * **The two `VehiclePicker` tests below are the one deliberate exception**,
 * the same shape `debugAndThemes.spec.ts` documents for Debugging Mode and
 * the Display theme: `vehicle_artwork_key` is install-wide too, but unlike
 * the seven words above it never changes what "Den"/"Pack"/"Car" *read* as
 * anywhere — it only picks which picture `VehicleGlyph` draws (#551 stage
 * 4's "the picture is an independent column, not derived from the word"),
 * and no other spec in this suite asserts on that picture. Each restores
 * the organization's own terminology to null (inherit) on the way out.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, seedRace } from './support';

test('a per-race terminology change updates the roster column without a reload', async ({
    page,
}) => {
    const race = await seedRace(page, 'Terminology Race');

    await page.goto(`/race/${race.raceId}`);

    // The organization default, inherited: no override has been set yet.
    const column = page.getByTestId('sort-racingGroup');
    await expect(column).toHaveText('Den');

    await page.getByRole('button', { name: 'Edit race' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();

    // The edit form is sectioned (#587) and opens on Event; the override is
    // under "Words and names".
    await dialog.getByTestId('race-settings-nav-words').click();
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

test('the Vehicle picture picker survives a save and a reload, in System Settings (#1250)', async ({
    page,
}) => {
    await ensureConfigured(page);

    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-general').click();
    await page.getByLabel('Use different words for “Den”, “Pack” and “Car”').check();

    try {
        await page.getByTestId('vehicle_artwork_key-option-boat').click();
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await expect(page.getByText('Settings saved')).toBeVisible();

        // A real reload, not just the in-memory click — the picture has to
        // come back from what was actually persisted, not from local state
        // that never left the page.
        await page.reload();
        await page.getByTestId('settings-nav-general').click();
        await expect(page.getByTestId('vehicle_artwork_key-option-boat')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('vehicle_artwork_key-option-car')).toHaveAttribute('aria-pressed', 'false');
    } finally {
        // Shared, install-wide state — leave it as this run found it
        // (`debugAndThemes.spec.ts` documents the same convention).
        await page.goto('/system-settings');
        await page.getByTestId('settings-nav-general').click();
        await page.getByLabel('Use different words for “Den”, “Pack” and “Car”').uncheck();
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await expect(page.getByText('Settings saved')).toBeVisible();
    }
});

test('the Vehicle picture picker survives a save and reopening the edit form, on a race override (#1250)', async ({
    page,
}) => {
    const race = await seedRace(page, 'Vehicle Picture Race');

    await page.goto(`/race/${race.raceId}`);
    await page.getByRole('button', { name: 'Edit race' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Race Details' });
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('race-settings-nav-words').click();
    await dialog.getByLabel('Use different words for this race').click();
    await dialog.getByTestId('race-vehicle-artwork-key-option-rocket').click();
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden();

    // Reopen the form fresh — the picker's selection has to come back from
    // the race's own stored `vehicle_artwork_key`, not from state the modal
    // happened to keep from the save above.
    await page.getByRole('button', { name: 'Edit race' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('race-settings-nav-words').click();
    await expect(dialog.getByTestId('race-vehicle-artwork-key-option-rocket')).toHaveAttribute('aria-pressed', 'true');
});
