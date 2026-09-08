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
    // one the checklist points at.
    await expect(page.getByTestId('setup-step-schedule')).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('setup-step-awards')).toHaveAttribute('data-done', 'false');

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
    // since driving the whole Edit Details form is not the step under test.
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
