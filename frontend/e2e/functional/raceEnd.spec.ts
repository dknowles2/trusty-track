/**
 * The two pieces of #847 that live in `features/management/`: a route to a
 * race's results from Home, and the setup checklist's continuation past the
 * schedule into awards and printables.
 *
 * The end-of-race modal itself (#855/#897) lives in `features/racing/` and is
 * covered there — this file is deliberately narrower, the two gaps a second
 * audit of the reopened issue traced to exactly these two files.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, seedRace } from './support';

test('the setup checklist keeps guiding past the schedule, to awards and printables (#847)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Checklist Continues');
    // seedRace already checks every racer in, so racingGroups, racers and
    // checkin are already behind us; a schedule is the last of the original
    // four.
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}`);

    const checklist = page.getByTestId('setup-checklist');
    await expect(checklist).toBeVisible();
    // The first four steps are done; awards is what is left, and it is the
    // one the checklist points at. `seedRace` checks every racer in, so
    // the panel is already collapsed to its one-line form (#949) — reading
    // `data-done` off a step's row works either way (it stays in the DOM,
    // just unpainted, while collapsed — see `SetupChecklist.tsx`), but
    // reaching the step's own action button needs the panel open first.
    await expect(page.getByTestId('setup-step-schedule')).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('setup-step-awards')).toHaveAttribute('data-done', 'false');

    await page.getByTestId('setup-checklist-summary').click();
    await page.getByRole('button', { name: 'Set up awards' }).click();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/awards$`));
});

test('locking the race quiets the awards and printables steps with no awards ever defined', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Checklist Locked');
    await createSchedule(page, raceId);

    // Locking is the "I am done deciding this" signal the checklist reads
    // for both trailing steps (setupChecklist.ts) — done through the API,
    // since driving the whole Edit race form is not the step under test.
    await gql(
        page,
        `mutation Lock($id: Int!, $race: RaceUpdateInput!) { updateRace(id: $id, race: $race) { id } }`,
        { id: raceId, race: { isLocked: true } },
    );

    await page.goto(`/race/${raceId}`);

    // Wait for the roster itself to have loaded before asserting the
    // checklist's absence, or an empty assertion could pass trivially
    // against a page that has not answered yet.
    await expect(page.getByText('Ada', { exact: true })).toBeVisible();
    await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
});

test("Home's overflow menu routes straight to a race's standings (#847)", async ({ page }) => {
    const { raceId } = await seedRace(page, 'Home Standings Route');

    await ensureConfigured(page);
    await page.goto('/');

    await page.getByTestId(`race-more-menu-${raceId}`).click();
    await page.getByTestId(`race-menu-standings-${raceId}`).click();

    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/standings$`));
});

// #1239: locking and unlocking a race used to be six steps through Edit
// race — this covers both directions from Home's own row menu, staying on
// Home throughout, and that a reload (a fresh query, not the normalized
// cache) still shows the locked state.
test("Home's row menu locks and unlocks a race in place, without navigating away (#1239)", async ({
    page,
}) => {
    const raceName = `Home Lock Menu ${Date.now()}`;
    const { raceId } = await seedRace(page, raceName);

    await ensureConfigured(page);
    await page.goto('/');

    const row = page.locator('tr', { hasText: raceName });
    await expect(row).toBeVisible();
    await expect(row.getByText('Locked', { exact: true })).toHaveCount(0);

    // Lock.
    await page.getByTestId(`race-more-menu-${raceId}`).click();
    const lockEntry = page.getByTestId(`race-menu-lock-${raceId}`);
    await expect(lockEntry).toHaveText('Lock race');
    await lockEntry.click();

    await expect(page.getByRole('heading', { name: 'Lock race?' })).toBeVisible();
    await expect(page.getByText(/Guards a finished race against accidental edits/)).toBeVisible();
    await page.getByRole('button', { name: 'Lock race' }).click();

    // Still on Home — the point of the menu entry is not leaving the page —
    // and the badge appears in place.
    await expect(page).toHaveURL(/\/$/);
    await expect(row.getByText('Locked', { exact: true })).toBeVisible();

    // A reload proves this is a real, persisted mutation, not just a
    // client-side optimistic flip.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tr', { hasText: raceName }).getByText('Locked', { exact: true })).toBeVisible();

    // Unlock.
    await page.getByTestId(`race-more-menu-${raceId}`).click();
    const unlockEntry = page.getByTestId(`race-menu-lock-${raceId}`);
    await expect(unlockEntry).toHaveText('Unlock race');
    await unlockEntry.click();

    await expect(page.getByRole('heading', { name: 'Unlock race?' })).toBeVisible();
    await expect(page.getByText(/Scheduling, results, registrations and awards become editable again/)).toBeVisible();
    await page.getByRole('button', { name: 'Unlock race' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('tr', { hasText: raceName }).getByText('Locked', { exact: true })).toHaveCount(0);
});

test("Home's row menu confirm can be cancelled, leaving the race's lock state untouched (#1239)", async ({
    page,
}) => {
    const raceName = `Home Lock Cancel ${Date.now()}`;
    const { raceId } = await seedRace(page, raceName);

    await ensureConfigured(page);
    await page.goto('/');

    await page.getByTestId(`race-more-menu-${raceId}`).click();
    await page.getByTestId(`race-menu-lock-${raceId}`).click();

    await expect(page.getByRole('heading', { name: 'Lock race?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Lock race?' })).toHaveCount(0);
    await expect(page.locator('tr', { hasText: raceName }).getByText('Locked', { exact: true })).toHaveCount(0);
});
