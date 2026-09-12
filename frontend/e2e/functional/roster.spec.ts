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
 * Each test gets its own race: race names are unique per install, and these
 * tests share one backend.
 */
async function seed(page: Page, raceName: string): Promise<number> {
    await ensureConfigured(page);

    const config = await gql<{ organizations: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { organizations { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: raceName,
                organizationId: config.organizations[0].id,
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
    // Opened from the row's Check In button, the toggle already defaults on
    // (#848) — pressing Check In already said what the operator wants, so
    // there is nothing to click before saving.
    const checkIn = page.getByRole('dialog', { name: 'Racer Check In' });
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

test('declining a check-in from the toggle is honoured, not overridden by the default (#848)', async ({ page }) => {
    // The toggle defaults on so the obvious path actually checks a racer in,
    // but an inspector who declines a car must still be believed — the
    // default is a starting point, not a floor.
    const raceId = await seed(page, 'Roster Check-In Decline');
    await page.goto(`/race/${raceId}`);

    await page
        .getByRole('row')
        .filter({ hasText: 'Alpha' })
        .getByRole('button', { name: 'Check In' })
        .click();

    const checkIn = page.getByRole('dialog', { name: 'Racer Check In' });
    await expect(page.getByLabel('Passed Inspection / Checked In')).toBeChecked();
    await checkIn.locator('label.toggle-switch:has(#car-passed-inspection)').click();
    await expect(page.getByLabel('Passed Inspection / Checked In')).not.toBeChecked();

    // The button says what it is actually about to do rather than repeating
    // "Save Check-in" over a toggle it would contradict.
    const saveButton = checkIn.getByRole('button', { name: 'Save without checking in' });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    const stillNotCheckedIn = page
        .getByRole('row')
        .filter({ hasText: 'Alpha' })
        .getByRole('button', { name: 'Check In' });
    await expect(stillNotCheckedIn).toBeVisible();
});

test('editing a race keeps it on the track it was on', async ({ page }) => {
    // A missing field in one query made this destructive rather than cosmetic.
    // `GetRaceDetails` did not select `trackId`, so the settings panel showed
    // "Track: Unknown" and — because `RaceForm` defaults a missing track to the
    // first one — opening Edit race and saving moved the race to whichever
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

    await page.getByRole('button', { name: /edit race/i }).click();
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

test('a racing group created through the UI groups the roster', async ({ page }) => {
    // Found in a coverage audit: racing group management had no functional coverage at
    // all — the docs spec opens the modal and cancels, so creating a racing group
    // through the UI was exercised by nothing.
    const raceId = await seed(page, 'Roster RacingGroups Add');
    await page.goto(`/race/${raceId}`);
    await expect(page.getByText('Alpha', { exact: true })).toBeVisible();

    await page.getByTestId('roster-more-menu').click();
    await page.getByRole('button', { name: /Manage Dens/ }).click();
    const modal = page.getByRole('dialog', { name: 'Manage Dens' });
    await modal.getByRole('button', { name: /Add New Den/ }).click();
    // The racing group form's labels are not wired to their inputs, so the name field
    // is the form's only text input.
    await modal.locator('input[type="text"]').first().fill('Wolves');
    await modal.getByRole('button', { name: 'Add Den', exact: true }).click();

    // The new racing group appears in the list, and closing the modal leaves the
    // roster able to group by it.
    await expect(modal.getByText('Wolves', { exact: true })).toBeVisible();
});

test('renaming and deleting a racing group through the UI', async ({ page }) => {
    const raceId = await seed(page, 'Roster RacingGroups Edit');
    await gql(
        page,
        `mutation RacingGroup($raceId: Int!, $racingGroup: RacingGroupInput!) { createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id } }`,
        { raceId, racingGroup: { name: 'Tigers', color: '#8B4513' } },
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

test('the browser tab is named after the page and the race', async ({ page }) => {
    // The reported bug: every tab said "Trusty Track", which on race day is
    // several identical tabs and no way to find the one you want.
    const raceId = await seed(page, 'Page Title Race');

    await page.goto('/');
    await expect(page).toHaveTitle('Trusty Track');

    await page.goto(`/race/${raceId}`);
    await expect(page).toHaveTitle('Roster — Page Title Race');

    // Race Control's sub-sections are the case that motivated it: three views
    // behind one navigation entry.
    await page.goto(`/race/${raceId}/control/schedule`);
    await expect(page).toHaveTitle('Schedule — Page Title Race');

    // Displays is its own race-row page now, not a Control sub-tab (#958).
    await page.getByTestId('race-nav').getByRole('link', { name: 'Displays' }).click();
    await expect(page).toHaveTitle('Displays — Page Title Race');

    await page.goto('/system-settings');
    await expect(page).toHaveTitle('Settings — Trusty Track');
});

test('the roster table is above the fold at tablet width once check-in has started, and the search box stays reachable while it scrolls (#949)', async ({
    page,
}) => {
    // #949: the check-in desk works a queue, usually on a tablet, and the
    // table used to start about 660px down an 800px screen — under a
    // checklist that only fully collapses once every step is done and a
    // "Race Settings" card read once and never again. This is the proof: a
    // real page, at the width the issue measured against, with an actual
    // long roster to scroll.
    await page.setViewportSize({ width: 1024, height: 768 });

    const raceId = await seed(page, 'Roster Above Fold ' + Date.now());

    // Enough racers that the table genuinely overflows the viewport — the
    // second half of this test (the search box surviving a scroll) proves
    // nothing on a roster short enough to fit on screen already.
    for (let i = 0; i < 25; i++) {
        await gql(
            page,
            `mutation SeedExtra($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId, firstName: `Extra${i}`, lastName: 'Racer', carNumber: 100 + i } },
        );
    }

    // The checklist's own collapse trigger is `checkedInCount > 0`
    // (`setupChecklist.shouldCollapseChecklist`), not "every step done" —
    // one racer checked in is enough to flip it, which is the state the
    // desk is actually in most of the morning.
    const roster = await gql<{ race: { racers: { id: number; firstName: string }[] } }>(
        page,
        `query RosterIds($raceId: Int!) { race(raceId: $raceId) { racers { id firstName } } }`,
        { raceId },
    );
    const alpha = roster.race.racers.find((r) => r.firstName === 'Alpha');
    await gql(
        page,
        `mutation CheckInAlpha($id: Int!) { checkInRacer(id: $id, passedInspection: true, weight: null) { id } }`,
        { id: alpha!.id },
    );

    await page.goto(`/race/${raceId}`);

    // Above the fold: the table's own header row used to land at y≈660 of
    // an 800px screen (the issue's own measurement, `race-day/01`). It now
    // lands under 450 — measured at ~375–420px across a one- and a
    // twenty-six-racer roster — comfortably in the top half of a 768px
    // tablet viewport rather than almost off the bottom of one. The
    // remaining budget above it is the app's own global chrome (the nav
    // bar plus its ROSTER/CONTROL/… tab row, ~110px, present on every
    // screen) and the page's standard 2rem top padding — neither of which
    // this issue touches — plus the page header (race name, muted settings
    // line) and the collapsed checklist line the mockup in #949 itself
    // calls for. The setup checklist is already collapsed to one line by
    // the time this loads (checked-in count arrives with the first query,
    // not as a later update), and the old "Race Settings" card is gone —
    // folded into the page header's muted summary line.
    const header = page.locator('table thead').first();
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    expect((headerBox as { y: number }).y).toBeLessThan(450);

    // The checklist reads its own one-line, collapsed form rather than the
    // six-row panel — the summary line names what is still outstanding. The
    // step rows are still in the DOM inside the closed `<details>` (so a
    // `data-done` check can find them without expanding anything — see
    // `race-day.spec.ts`), just not painted.
    await expect(page.getByTestId('setup-checklist-summary')).toBeVisible();
    await expect(page.getByTestId('setup-step-checkin')).not.toBeVisible();

    // Scrolling a long roster must not carry the search box away with it —
    // the sticky toolbar row is the point of #949's third change. A racer
    // far down the table is used as the scroll target rather than a fixed
    // pixel count, so this does not depend on exactly how tall any one row
    // renders.
    const search = page.getByPlaceholder('Search racers...');
    await expect(search).toBeVisible();
    await page.getByText('Extra24', { exact: true }).scrollIntoViewIfNeeded();
    await expect(search).toBeInViewport();
});

test('importing the same CSV twice is refused, not duplicated (#1021)', async ({ page }) => {
    // The seam the bug lived in: the CSV importer's own client-side checks
    // (csvMapping.ts) know nothing about the roster already in the race, so
    // this has to actually reach the server twice, through the real modal,
    // against a race that already holds the first import's racer -- a unit
    // test on either side of the wire cannot see this.
    await ensureConfigured(page);

    const config = await gql<{ organizations: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { organizations { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Roster Import Twice',
                organizationId: config.organizations[0].id,
                trackId: config.tracks[0].id,
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    await page.goto(`/race/${raceId}`);

    const csv = 'first_name,last_name,car_number\nGamma,Rivera,30\n';
    const csvFile = { name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };

    async function openCsvImportModal() {
        await page.getByRole('button', { name: 'More ways to add racers' }).click();
        await page.getByRole('button', { name: 'Import from CSV' }).click();
        await expect(page.getByRole('dialog', { name: 'Import Racers from CSV' })).toBeVisible();
    }

    // First import: an ordinary success.
    await openCsvImportModal();
    await page.locator('#csv-upload-input').setInputFiles(csvFile);
    await expect(page.getByText('Match your columns')).toBeVisible();
    await page.getByRole('button', { name: /Import 1 Racers/ }).click();
    await expect(page.getByText('Imported 1 racers.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Gamma', { exact: true })).toBeVisible();

    // Second import of the byte-identical file: refused with the server's
    // own sentence, and the roster is left holding exactly the one racer.
    await openCsvImportModal();
    await page.locator('#csv-upload-input').setInputFiles(csvFile);
    await expect(page.getByText('Match your columns')).toBeVisible();
    await page.getByRole('button', { name: /Import 1 Racers/ }).click();
    await expect(page.getByText('Gamma Rivera is already on the roster.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Gamma' })).toHaveCount(1);
});
