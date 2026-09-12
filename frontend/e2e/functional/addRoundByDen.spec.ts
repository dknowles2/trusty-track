/**
 * The Add Round dialog's "By Den" format, through the screen it is actually
 * driven from (#1013, #1025).
 *
 * `RoundConfigModal` has offered a Format picker — "All {org}" or "By
 * {group}" — for a while, and even counts the rounds it is about to create
 * ("Will create 2 rounds") and renames its own submit button to "Add
 * rounds". None of that ever reached the backend: `createRound` declared
 * `generalType` on its input and never read it, so choosing "By Den" from
 * this exact dialog silently built one mixed "All Pack" round instead of one
 * per den. Nothing in the suite had driven the dialog and a multi-den race
 * together before — the seam #1025 calls out — which is why the bug shipped
 * invisibly through code review and every existing unit test.
 */

import { test, expect } from '@playwright/test';
import { gql, seedRace } from './support';

test('choosing "By Den" from Add Round creates one round per den, not one mixed round', async ({
    page,
}) => {
    // Not named anything containing "Add Round" or "Add round" — the race's
    // own name shows up as a button in the navigation's race switcher, and
    // Playwright's accessible-name matching is substring, so a race called
    // "Add Round By Den" makes `getByRole('button', { name: 'Add Round' })`
    // ambiguous with the nav's own race-name button.
    const { raceId, racers } = await seedRace(page, 'By Den Add Round Seam');

    const groupIds: number[] = [];
    for (const groupName of ['Lions', 'Tigers']) {
        const created = await gql<{ createRacingGroup: { id: number } }>(
            page,
            `mutation SeedGroup($raceId: Int!, $racingGroup: RacingGroupInput!) {
                createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
            }`,
            { raceId, racingGroup: { name: groupName, color: '#003F87' } },
        );
        groupIds.push(created.createRacingGroup.id);
    }
    await gql(
        page,
        `mutation SeedMove($racerIds: [Int!]!, $racingGroupId: Int) {
            bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
        }`,
        { racerIds: racers.slice(0, 3).map((r) => r.id), racingGroupId: groupIds[0] },
    );
    await gql(
        page,
        `mutation SeedMove($racerIds: [Int!]!, $racingGroupId: Int) {
            bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
        }`,
        { racerIds: racers.slice(3).map((r) => r.id), racingGroupId: groupIds[1] },
    );

    await page.goto(`/race/${raceId}/control/schedule`);
    await page.getByRole('button', { name: 'Add Round', exact: true }).click();

    await page.getByLabel(/By Den/).check();
    await expect(page.getByText('Will create 2 rounds (one per den).')).toBeVisible();

    await page.getByRole('button', { name: 'Add rounds', exact: true }).click();

    // The bug: a single mixed "All Pack" round instead of one per den.
    await expect(page.getByRole('heading', { name: 'Lions' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Tigers' })).toBeVisible();
    // Nothing named after the whole pack — the two den rounds are what
    // exist, not a third round beside them.
    await expect(page.getByRole('heading', { name: 'All Pack' })).toHaveCount(0);
});
