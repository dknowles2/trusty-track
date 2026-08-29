/**
 * Screenshots of the awards screens, for docs/awards.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-awards.spec.ts
 *
 * Races a full round on the fake timer before capturing anything. A speed
 * award resolves its winner from the standings on every read, so a race with
 * no results screenshots as a page of "Not decided by the racing yet" — which
 * is a real state, but not the one the page is explaining.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, gql, organizationId, photosFor } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/awards');

// Two racingGroups, and the fastest car overall is deliberately not a Wolf — with one
// racingGroup, "Fastest Car" and "Fastest Wolf" name the same child and the screenshot
// stops explaining what a racing-group-scoped award is for.
const DENS = [
    { name: 'Wolves', color: '#8B4513', division: 'Wolf' },
    { name: 'Bears', color: '#1E5631', division: 'Bear' },
];

// Listed fastest first: the times below are assigned in this order, so the
// standings are this order. Three awards then have three different winners,
// which is what makes "Fastest Wolf" legible as a different thing from
// "Fastest Car" rather than a second name for it.
const RACERS = [
    { first: 'Ada', last: 'Lovelace', car: 3, name: 'Blue Streak', racingGroup: 'Bears' },
    { first: 'Katherine', last: 'Johnson', car: 14, name: 'Red Comet', racingGroup: 'Bears' },
    { first: 'Grace', last: 'Hopper', car: 7, name: 'Thunderbolt', racingGroup: 'Wolves' },
    { first: 'Alan', last: 'Turing', car: 11, name: 'Silver Arrow', racingGroup: 'Wolves' },
    { first: 'Chien-Shiung', last: 'Wu', car: 22, name: 'Green Machine', racingGroup: 'Bears' },
    { first: 'Mae', last: 'Jemison', car: 18, name: 'Night Owl', racingGroup: 'Wolves' },
];

test('screenshot the awards screens', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);

    const raceOrganizationId = await organizationId(page);
    const raceTrackId = await docsTrackId(page);
    const trackId = raceTrackId;

    const race = await gql(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Pack 42 Awards Night',
                dateTime: '2026-03-14T09:30:00',
                location: 'St Anne’s Parish Hall',
                organizationId: raceOrganizationId,
                trackId,
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    const racingGroupIds: Record<string, number> = {};
    for (const racingGroup of DENS) {
        const created = await gql(
            page,
            `mutation RacingGroup($raceId: Int!, $racingGroup: RacingGroupInput!) { createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id } }`,
            { raceId, racingGroup },
        );
        racingGroupIds[racingGroup.name] = created.createRacingGroup.id;
    }
    const wolvesId = racingGroupIds['Wolves'];

    const racerIds: Record<number, number> = {};
    for (const [index, racer] of RACERS.entries()) {
        const created = await gql(
            page,
            `mutation Racer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    racingGroupId: racingGroupIds[racer.racingGroup],
                    firstName: racer.first,
                    lastName: racer.last,
                    carNumber: racer.car,
                    carName: racer.name,
                    carPassedInspection: true,
                    ...(await photosFor(page, index)),
                },
            },
        );
        racerIds[racer.car] = created.createRacer.id;
    }

    // A raced preliminary round, so the speed awards have standings to resolve
    // against. Results go in through the API rather than the fake timer: this
    // spec is about the awards screens, and driving a heat is race-day's job.
    await gql(
        page,
        `mutation Round($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        {
            raceId,
            config: {
                generalRound: { type: 'ALL', runsPerLane: 1 },
                championshipRounds: [],
            },
        },
    );
    const scheduled = await gql(
        page,
        `query Heats($raceId: Int!) {
            race(raceId: $raceId) { heats { id lanes { lane racerId } } }
        }`,
        { raceId },
    );

    // A fixed time per racer rather than a spread per heat. Under TIMED scoring
    // everybody runs the same number of heats, so a constant makes the finishing
    // order the order below — which is what lets the two racingGroup awards be asserted
    // rather than hoped for.
    const timeOf = new Map<number, number>(
        RACERS.map((racer, index) => [racerIds[racer.car], 3.05 + index * 0.14]),
    );

    for (const heat of scheduled.race.heats) {
        const running = heat.lanes.filter(
            (lane: { racerId: number | null }) => lane.racerId !== null,
        );
        const order = [...running].sort(
            (a: { racerId: number }, b: { racerId: number }) =>
                timeOf.get(a.racerId)! - timeOf.get(b.racerId)!,
        );
        const lanes = running.map((lane: { lane: number; racerId: number }) => ({
            lane: lane.lane,
            racerId: lane.racerId,
            time: timeOf.get(lane.racerId)!,
            place: order.findIndex((other: { racerId: number }) => other.racerId === lane.racerId) + 1,
        }));
        await gql(
            page,
            `mutation Result($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes },
        );
    }

    const awards = [
        { name: 'Fastest Car', kind: 'SPEED', source: 'ALL', place: 1 },
        { name: 'Second Fastest', kind: 'SPEED', source: 'ALL', place: 2 },
        { name: 'Fastest Wolf', kind: 'SPEED', source: 'ALL', place: 1, racingGroupId: wolvesId },
        { name: 'Best Paint', kind: 'SPECIAL' },
        { name: 'Most Original', kind: 'SPECIAL' },
    ];
    for (const award of awards) {
        await gql(
            page,
            `mutation Award($raceId: Int!, $award: AwardInput!) {
                createAward(raceId: $raceId, award: $award) { id }
            }`,
            { raceId, award },
        );
    }

    // The list: what each award is for, and who currently holds it. The two
    // judged awards are deliberately left undecided, because that is what an
    // operator sees for most of the day.
    await page.goto(`/race/${raceId}/awards`);
    await expect(page.getByText('Fastest Car')).toBeVisible();
    // Assert the three winners rather than trusting the picture: a racing-group-scoped
    // award that happened to resolve to the overall winner would still
    // screenshot fine and would still be a useless illustration.
    await expect(page.getByText('Ada Lovelace (#3)')).toBeVisible();
    await expect(page.getByText('Katherine Johnson (#14)')).toBeVisible();
    await expect(page.getByText('Grace Hopper (#7)')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-awards-list.png') });

    // The form, on the speed side — the three fields the docs walk through.
    await page.getByRole('button', { name: 'Add an award' }).click();
    await expect(page.getByLabel('Award name')).toBeVisible();
    await page.getByLabel('Award name').fill('Fastest Wolf');
    await page.getByText('Speed-based').click();
    await expect(page.getByLabel('Standings to use')).toBeVisible();
    await page.getByLabel('Limited to a den').selectOption(String(wolvesId));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-speed-award-form.png') });

    // And the judged side, whose winner is a racer you pick.
    await page.getByText('Somebody we choose').click();
    await page.getByLabel('Award name').fill('Best Paint');
    await expect(page.getByLabel('Winner')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-judged-award-form.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();

    // The ceremony, which is a separate route rather than a tab: it fills the
    // screen and the navigation is not painted over it.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/race/${raceId}/awards/present`);
    await expect(page.getByText('Fastest Car')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-ceremony-slide.png') });

    // An award nobody has won yet still gets a slide. Most of them are in this
    // state right up until they are announced, so the docs show it.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText(/Still to be decided/i)).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-ceremony-undecided.png') });

    // The ready-made superlative picker (#306), on a fresh judged award —
    // opened new rather than reusing the cancelled one above, since Modal
    // unmounts its contents on close and a reopened AwardForm starts blank.
    // Choosing one just writes an ordinary name (and, invisibly here, an
    // artwork key) into the draft; both stay editable free-text fields
    // afterward, which is what makes the filled name worth photographing
    // rather than the dropdown's own options.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/race/${raceId}/awards`);
    await expect(page.getByText('Fastest Car')).toBeVisible();
    await page.getByRole('button', { name: 'Add an award' }).click();
    await expect(page.getByLabel('Award name')).toBeVisible();
    await page
        .getByLabel('Start from a ready-made award')
        .selectOption({ label: 'Most Aerodynamic' });
    await expect(page.getByLabel('Award name')).toHaveValue('Most Aerodynamic');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-award-template-picker.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();

    // The printable certificates (#306): one per award, in the ceremony's own
    // running order. `fullPage` rather than a viewport crop, because the
    // point of this picture is the variety down the stack — the speed awards
    // carry the trophy or medal artwork their rule computed, and the two
    // judged awards are still undecided, so each prints with a blank line
    // rather than being left out of the batch.
    await page.goto(`/race/${raceId}/print/certificates`);
    await expect(page.getByTestId('certificates')).toBeVisible();
    await expect(page.getByText('Fastest Car')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '07-certificates.png'),
        fullPage: true,
    });
});
