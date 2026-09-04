/**
 * The two pictures of an install with nothing in it yet, for
 * docs/getting-started.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-first-run.spec.ts
 *
 * This is a Playwright **setup project**: every other screenshot project
 * depends on it, so it runs first whatever is being filtered to, and the rest
 * of the suite can then assume a configured install with one track. That is
 * what lets the others run in parallel — the first-run gate and the
 * organization name are global state, and global state resolved by "whichever
 * spec happened to go first" cannot be.
 *
 * The first two shots here are claims about an *empty* system, so this is also
 * the only spec that may delete other people's races. It can, because nothing
 * else has started yet.
 *
 * It then takes the two System Settings pictures that belong to the **install**
 * rather than to a track, and which is why they are here rather than in
 * `screenshot-settings.spec.ts` with the rest of that page:
 *
 * - The **Access panel** needs an operator PIN to exist, so the Remove control
 *   is on screen. While a PIN is set, every caller without one is a `VIEWER`
 *   and no mutation is allowed at all (#15) — so taking this picture anywhere
 *   but here would refuse every mutation the specs running beside it make.
 * - The **activity log** is a list of everything anybody has done to this
 *   install. Taken from the parallel phase it would hold whatever the other
 *   specs happened to have got to, which is a different picture every run.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ORGANIZATION, docsTrackId, gql, organizationId } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GETTING_STARTED_DIR = path.resolve(
    __dirname,
    '../../../docs/assets/screenshots/getting-started',
);
const SETTINGS_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/settings');

test('screenshot the first run', async ({ page }) => {
    fs.mkdirSync(GETTING_STARTED_DIR, { recursive: true });
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    await page.setViewportSize({ width: 1200, height: 800 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 02: the setup wizard. A configured install never shows it, so this is
    // the one picture in the suite that has to be taken before anything else
    // touches the system.
    if (page.url().includes('/system-settings')) {
        await expect(page.getByLabel('Organization Name')).toBeVisible();
        await page.screenshot({ path: path.join(GETTING_STARTED_DIR, '02-system-settings.png') });
        await page.getByLabel('Organization Name').fill(ORGANIZATION);
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }

    // "Before any races exist" is what 01's caption says, so make it true.
    // Nothing else in the suite may do this — see the note at the top.
    const leftovers = await gql<{ races: Array<{ id: number }> }>(
        page,
        `query FirstRunLeftovers { races { id } }`,
    );
    for (const race of leftovers.races ?? []) {
        await gql(page, `mutation FirstRunDrop($id: Int!) { deleteRace(id: $id) }`, {
            id: race.id,
        });
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Welcome to Trusty Track' })).toBeVisible();

    // 01: the home page of an install with no races on it.
    await page.screenshot({ path: path.join(GETTING_STARTED_DIR, '01-home-page.png') });

    // 03: the wizard's "Kind of event" step (#662), for
    // docs/getting-started.md's "Creating Your First Race" section. This used
    // to be taken in the parallel phase, where whether the wizard's opening
    // "Start" step (scratch vs. copy a previous race) had already been shown
    // depends on whether some other spec's race happened to exist yet — a
    // fact the questions step's own step-count header renders, so the
    // picture changed run to run for reasons that had nothing to do with the
    // wizard (#708). No race exists yet at this point in this project, so the
    // wizard always lands on this step directly with nothing before it,
    // which is also the state the section is actually about: a first-time
    // operator has no previous race to be offered.
    await page.getByRole('button', { name: /Create New Race/i }).click();
    await expect(page.getByTestId('setup-step-start')).toHaveCount(0);
    await expect(page.getByTestId('setup-step-kind')).toBeVisible();
    await page.screenshot({ path: path.join(GETTING_STARTED_DIR, '03-new-race-questions.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Create New Race Event' })).toBeHidden();

    // 03 (copy): the setup wizard's "copy settings from a previous race"
    // choice (#662). It is offered only once a race exists, and it lists every
    // race there is — so it is photographed here, the one place that can
    // promise exactly one race exists and that it is this spec's own. Made
    // through the API with the six dens the wizard itself would scaffold, so
    // the summary line has something to name, and deleted again afterwards so
    // the parallel phase starts from the install 01 shows.
    const lastYear = await gql<{ createRace: { id: number } }>(
        page,
        `mutation FirstRunLastYear($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: '2025 Pinewood Derby',
                dateTime: '2025-03-07T18:00',
                location: 'School Gym',
                trackId: await docsTrackId(page),
                racingGroups: [
                    { name: 'Lion', color: '#F4D03F', division: 'Lion', carNumberRangeStart: 100, carNumberRangeEnd: 199 },
                    { name: 'Tiger', color: '#E67E22', division: 'Tiger', carNumberRangeStart: 200, carNumberRangeEnd: 299 },
                    { name: 'Wolf', color: '#AAB7B8', division: 'Wolf', carNumberRangeStart: 300, carNumberRangeEnd: 399 },
                    { name: 'Bear', color: '#85C1E9', division: 'Bear', carNumberRangeStart: 400, carNumberRangeEnd: 499 },
                    { name: 'Webelos', color: '#2E86C1', division: 'Webelos', carNumberRangeStart: 500, carNumberRangeEnd: 599 },
                    { name: 'Arrow of Light', color: '#CB4335', division: 'Arrow of Light', carNumberRangeStart: 600, carNumberRangeEnd: 699 },
                ],
            },
        },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Create New Race/i }).click();
    await expect(page.getByTestId('setup-step-start')).toBeVisible();
    await page.getByRole('radio', { name: /^Copy settings from a previous race/ }).click();
    await page.getByLabel('Previous race', { exact: true }).selectOption(String(lastYear.createRace.id));
    await expect(page.getByTestId('setup-source-summary')).toContainText('Arrow of Light');
    await page.screenshot({ path: path.join(GETTING_STARTED_DIR, '03-new-race-copy.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Create New Race Event' })).toBeHidden();
    await gql(page, `mutation FirstRunDropLastYear($id: Int!) { deleteRace(id: $id) }`, {
        id: lastYear.createRace.id,
    });

    // The Access panel, with a PIN set so the Remove control is on screen — it
    // is only offered for a PIN that exists, and it is the whole subject of the
    // "changing or removing a PIN" section (#192).
    //
    // Saving leaves this page — and, when the PIN changed, reloads so the
    // subscription socket picks the new credential up. Come back to it.
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-access').click();
    await page.getByLabel('Operator PIN').fill('1234');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForURL('**/', { waitUntil: 'networkidle' });
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-access').click();
    await expect(page.getByTestId('operator_pin-remove')).toBeVisible();
    await page
        .getByTestId('access-panel')
        .screenshot({ path: path.join(SETTINGS_DIR, '03-access-pins.png') });

    // Put it back before anything else starts. Everything below, and every
    // spec in the phases after this one, mutates without a PIN header.
    await page.getByTestId('operator_pin-remove').click();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForURL('**/', { waitUntil: 'networkidle' });
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-access').click();
    await expect(page.getByTestId('operator_pin-remove')).toHaveCount(0);

    // The activity log (#219). It needs something to show, so make a little
    // history first — including one thing a person did by hand, so the picture
    // carries the distinction the page exists to draw.
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation ActivityShotRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Activity Shot Derby',
                organizationId: await organizationId(page),
                trackId: await docsTrackId(page),
                carNumberingStrategy: 'GLOBAL',
            },
        },
    );
    await gql(
        page,
        `mutation ActivityShotRacingGroup($raceId: Int!, $racingGroup: RacingGroupInput!) {
            createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
        }`,
        { raceId: race.createRace.id, racingGroup: { name: 'Wolves', color: '#8B4513' } },
    );
    await gql(
        page,
        `mutation ActivityShotRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
        {
            racer: {
                raceId: race.createRace.id,
                firstName: 'Alex',
                lastName: 'Rivera',
                carNumber: 3,
            },
        },
    );

    await page.goto('/activity');
    await expect(page.getByText('Created a race').first()).toBeVisible();
    await page.screenshot({ path: path.join(SETTINGS_DIR, '04-activity-log.png') });
});
