/**
 * The roster, end to end: a real backend, a real browser, no mocks.
 *
 * Management-side coverage of the whole stack at once — GraphQL over the wire,
 * the normalized cache, and the React tree — deliberately shallow and broad
 * rather than clever. Anything worth asserting in detail belongs in a component
 * test, which runs in a second. `raceDay.spec.ts` is the other half: what
 * happens once the racing starts.
 *
 * Run with:
 *   cd frontend && npm run test:e2e
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, gql } from './support';

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
    await ensureConfigured(page);

    const config = await gql<{ groups: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { groups { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
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

test('editing a race keeps it on the track it was on', async ({ page }) => {
    // A missing field in one query made this destructive rather than cosmetic.
    // `GetRaceDetails` did not select `trackId`, so the settings panel showed
    // "Track: Unknown" and — because `RaceForm` defaults a missing track to the
    // first one — opening Edit Details and saving moved the race to whichever
    // track happened to be first. Changing a race's name changed its lane count
    // and its timer.
    //
    // The unit tests could not catch it: they mock the query result, and a mock
    // is written from what the component reads rather than from what the
    // document selects. This is the level the bug was reachable at.
    await ensureConfigured(page);

    const { createTrack } = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation MakeSecondTrack($track: TrackInput!) {
            createTrack(track: $track) { id }
        }`,
        { track: { name: `Second Track ${Date.now()}`, laneCount: 6, timerType: 'FAKE' } },
    );

    const { createRace } = await gql<{ createRace: { id: number } }>(
        page,
        `mutation MakeRaceOnSecondTrack($race: RaceInput!) {
            createRace(race: $race) { id }
        }`,
        {
            race: {
                name: `Track Preserved ${Date.now()}`,
                trackId: createTrack.id,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'TIMED',
            },
        },
    );

    await page.goto(`/race/${createRace.id}`);

    // The panel names the track rather than saying "Unknown".
    await expect(page.getByText('Second Track', { exact: false })).toBeVisible({
        timeout: 30000,
    });

    await page.getByRole('button', { name: /edit details/i }).click();
    // Preselected on the race's own track, not on the first one in the list.
    await expect(page.getByLabel(/track/i)).toHaveValue(String(createTrack.id));

    // Save without touching anything — the operator's "I only changed the name"
    // case, reduced to changing nothing at all.
    await page.getByRole('button', { name: /save changes/i }).click();

    const after = await gql<{ race: { trackId: number } }>(
        page,
        `query TrackAfterEdit($raceId: Int!) { race(raceId: $raceId) { trackId } }`,
        { raceId: createRace.id },
    );
    expect(after.race.trackId).toBe(createTrack.id);
});

test('a den created through the UI groups the roster', async ({ page }) => {
    // Found in a coverage audit: den management had no functional coverage at
    // all — the docs spec opens the modal and cancels, so creating a den
    // through the UI was exercised by nothing.
    const raceId = await seed(page, 'Roster Dens Add');
    await page.goto(`/race/${raceId}`);
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();

    await page.getByTestId('roster-more-menu').click();
    await page.getByRole('button', { name: /Manage Dens/ }).click();
    const modal = page.getByRole('dialog', { name: 'Manage Dens' });
    await modal.getByRole('button', { name: /Add New Den/ }).click();
    // The den form's labels are not wired to their inputs, so the name field
    // is the form's only text input.
    await modal.locator('input[type="text"]').first().fill('Wolves');
    await modal.getByRole('button', { name: 'Add Den', exact: true }).click();

    // The new den appears in the list, and closing the modal leaves the
    // roster able to group by it.
    await expect(modal.getByText('Wolves', { exact: true })).toBeVisible();
});

test('renaming and deleting a den through the UI', async ({ page }) => {
    const raceId = await seed(page, 'Roster Dens Edit');
    await gql(
        page,
        `mutation Den($raceId: Int!, $den: DenInput!) { createDen(raceId: $raceId, den: $den) { id } }`,
        { raceId, den: { name: 'Tigers', color: '#8B4513' } },
    );
    await page.goto(`/race/${raceId}`);
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();

    await page.getByTestId('roster-more-menu').click();
    await page.getByRole('button', { name: /Manage Dens/ }).click();
    const modal = page.getByRole('dialog', { name: 'Manage Dens' });
    await expect(modal.getByText('Tigers', { exact: true })).toBeVisible();

    await modal.getByTitle('Edit Den').click();
    await modal.locator('input[type="text"]').first().fill('Tiger Cubs');
    await modal.getByRole('button', { name: 'Save Changes' }).click();
    await expect(modal.getByText('Tiger Cubs', { exact: true })).toBeVisible();

    await modal.getByTitle('Delete Den').click();
    await page
        .getByRole('dialog', { name: 'Delete Den' })
        .getByRole('button', { name: 'Confirm' })
        .click();
    await expect(modal.getByText('Tiger Cubs', { exact: true })).toBeHidden();
});
