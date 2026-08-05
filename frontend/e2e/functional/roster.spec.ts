/**
 * The roster, end to end: a real backend, a real browser, no mocks.
 *
 * This is the only test in the tree that exercises the whole stack at once —
 * GraphQL over the wire, the normalized cache, and the React tree — so it is
 * deliberately shallow and broad rather than clever. Anything worth asserting
 * in detail belongs in a component test, which runs in a second.
 *
 * Run with:
 *   cd frontend && npm run test:e2e
 */

import { test, expect, type Page } from '@playwright/test';

const BACKEND_URL = 'http://127.0.0.1:8002';

async function gql(page: Page, query: string, variables: Record<string, unknown> = {}) {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

const RACERS = [
    { first: 'Alpha', last: 'Rivera', car: 10 },
    { first: 'Beta', last: 'Okafor', car: 20 },
];

/** A configured system with one race and two racers.
 *
 * Each test gets its own race: race names are unique per install, and the
 * three tests share one backend.
 */
async function seed(page: Page, raceName: string): Promise<number> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill('Pack 42');
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }

    const config = await gql(page, `query { groups { id } tracks { id } }`);
    const race = await gql(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: raceName,
                groupId: config.groups[0].id,
                trackId: config.tracks[0].id,
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    for (const racer of RACERS) {
        await gql(
            page,
            `mutation Racer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    firstName: racer.first,
                    lastName: racer.last,
                    carNumber: racer.car,
                },
            },
        );
    }
    return raceId;
}

test('the roster loads over the real API', async ({ page }) => {
    // The stack test: served page, GraphQL request, normalized cache, render.
    // The mocked version of this could not have caught a cache change, and
    // silently stopped rendering anything when one landed.
    const raceId = await seed(page, 'Roster Load');

    await page.goto(`/race/${raceId}`);

    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta', { exact: true })).toBeVisible();
});

test('search narrows the roster by name and by car number', async ({ page }) => {
    const raceId = await seed(page, 'Roster Search');
    await page.goto(`/race/${raceId}`);
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();

    const search = page.getByPlaceholder('Search racers...');

    await search.fill('Alpha');
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta', { exact: true })).toBeHidden();

    await search.fill('20');
    await expect(page.getByText('Alpha', { exact: true })).toBeHidden();
    await expect(page.getByText('Beta', { exact: true })).toBeVisible();
});

test('a racer checked in through the UI stays checked in', async ({ page }) => {
    // A write, a subscription-driven refresh, and a reload — the round trip a
    // component test cannot make.
    const raceId = await seed(page, 'Roster Check-In');
    await page.goto(`/race/${raceId}`);

    await page
        .getByRole('row')
        .filter({ hasText: 'Alpha' })
        .getByRole('button', { name: 'Check In' })
        .click();
    // The checkbox itself is visually hidden behind the slider, so click what
    // the operator clicks.
    const checkIn = page.getByRole('dialog', { name: 'Racer Check In' });
    await checkIn.locator('label.toggle-switch').click();
    await expect(page.getByLabel('Passed Inspection / Checked In')).toBeChecked();
    await checkIn.getByRole('button', { name: 'Save Check-in' }).click();

    const checkedIn = page
        .getByRole('row')
        .filter({ hasText: 'Alpha' })
        .getByRole('button', { name: /Checked In/ });
    await expect(checkedIn).toBeVisible();

    await page.reload();
    await expect(checkedIn).toBeVisible();
});
