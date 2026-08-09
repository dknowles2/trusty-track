/**
 * Screenshots of the print sheets, for docs/printables.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-printables.spec.ts
 *
 * Sets its own race up through the API rather than reusing whatever another
 * spec left behind, so the sheets show the same roster every time and a
 * regenerated screenshot is a real diff rather than reshuffled names.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/printables');
const BACKEND_URL = 'http://127.0.0.1:8001';

async function gql(page: Page, query: string, variables: Record<string, unknown> = {}) {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

// A camera that exists but sees a test pattern, so the scanner screenshots as
// a live viewfinder instead of "could not open the camera".
test.use({
    launchOptions: {
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    permissions: ['camera'],
});

const RACERS = [
    { first: 'Alex', last: 'Rivera', car: 3, name: 'Blue Streak' },
    { first: 'Sam', last: 'Okafor', car: 7, name: 'Thunderbolt' },
    { first: 'Jordan', last: 'Chen', car: 11, name: 'Silver Arrow' },
    { first: 'Riley', last: 'Novak', car: 14, name: 'Red Comet' },
    { first: 'Casey', last: 'Ahmed', car: 18, name: 'Night Owl' },
    { first: 'Morgan', last: 'Silva', car: 22, name: 'Green Machine' },
];

test('screenshot the print sheets', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 1000 });

    // First run of the day lands on the setup wizard; a later spec may already
    // have cleared it.
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
                name: 'Pack 42 Pinewood Derby',
                dateTime: '2026-03-14T09:30:00',
                location: 'St Anne’s Parish Hall',
                groupId: config.groups[0].id,
                trackId: config.tracks[0].id,
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    const den = await gql(
        page,
        `mutation Den($raceId: Int!, $den: DenInput!) { createDen(raceId: $raceId, den: $den) { id } }`,
        { raceId, den: { name: 'Wolves', color: '#8B4513', rank: 'WOLF' } },
    );

    for (const racer of RACERS) {
        await gql(
            page,
            `mutation Racer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    denId: den.createDen.id,
                    firstName: racer.first,
                    lastName: racer.last,
                    carNumber: racer.car,
                    carName: racer.name,
                },
            },
        );
    }

    for (const kind of ['pit-pass', 'drivers-license', 'check-in-code']) {
        await page.goto(`/race/${raceId}/print?kind=${kind}`);
        await expect(page.locator('.print-card').first()).toBeVisible();
        // The QR codes come from the backend as images; a sheet caught
        // mid-load screenshots as empty boxes.
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${kind}-sheet.png`) });

        // One card on its own, at a size the detail is readable at.
        await page
            .locator('.print-card')
            .first()
            .screenshot({ path: path.join(SCREENSHOT_DIR, `${kind}-card.png`), scale: 'css' });
    }

    // Where the operator starts: the roster's Print and Scan controls. Print
    // moved behind the overflow in #186, so the picture has to show the menu
    // open — otherwise it is a photograph of a button that is not there.
    await page.goto(`/race/${raceId}`);
    await page.getByTestId('roster-more-menu').click();
    await expect(page.getByRole('button', { name: /^Print$/ })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'roster-print-button.png') });

    // The heat sheet: the running order on paper (#173). It needs a schedule,
    // which the cards above do not, so the round is generated here rather than
    // in the seeding at the top.
    // The scanner. Chromium is given a fake camera below, so this shows the
    // viewfinder rather than the permission error a headless run would hit.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Scan/ }).click();
    await expect(page.getByText('Scan to Check In')).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'check-in-scanner.png') });

    // The schedule fields checked-in racers only, and these were created for
    // their cards rather than for racing. Checked in here rather than at
    // creation so the card screenshots above are untouched.
    const roster = await gql(
        page,
        `query SheetRoster($raceId: Int!) { race(raceId: $raceId) { racers { id } } }`,
        { raceId },
    );
    await gql(
        page,
        `mutation SheetCheckIn($ids: [Int!]!) {
            bulkCheckIn(racerIds: $ids, passedInspection: true)
        }`,
        { ids: roster.race.racers.map((r: { id: number }) => r.id) },
    );
    await gql(
        page,
        `mutation SheetRound($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        {
            raceId,
            config: {
                generalRound: { type: 'PACK', runsPerLane: 1 },
                championshipRounds: [],
            },
        },
    );
    await page.goto(`/race/${raceId}/print/heat-sheet`);
    await expect(page.locator('.heat-sheet table').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'heat-sheet.png') });

    // The results sheet is the other half of the pair (#206): the heat sheet
    // before the racing, this one after it. Both wanted here rather than in a
    // spec of their own, because they share this race's roster and schedule.
    // A second den, added only now so the card screenshots above are untouched
    // — and worth adding at all because the per-den tables collapse when a race
    // has one den, which would leave that half of the sheet unillustrated.
    const bears = await gql(
        page,
        `mutation SecondDen($raceId: Int!, $den: DenInput!) {
            createDen(raceId: $raceId, den: $den) { id }
        }`,
        { raceId, den: { name: 'Bears', color: '#1F4E79', rank: 'BEAR' } },
    );
    const half = roster.race.racers.slice(3).map((r: { id: number }) => r.id);
    await gql(
        page,
        `mutation SheetMove($ids: [Int!]!, $denId: Int) {
            bulkMoveToDen(racerIds: $ids, denId: $denId)
        }`,
        { ids: half, denId: bears.createDen.id },
    );

    const heats = await gql(
        page,
        `query SheetHeats($raceId: Int!) {
            race(raceId: $raceId) {
                racers { id carNumber }
                heats { id lanes { lane racerId placeholderSlot } }
            }
        }`,
        { raceId },
    );
    // Times keyed off the car number rather than the lane, so every racer gets
    // a distinct average and the standings read as a real ranking. Keyed off
    // the lane, everybody scored the same and the order looked arbitrary.
    const carNumber = new Map<number, number>(
        heats.race.racers.map((r: { id: number; carNumber: number }) => [r.id, r.carNumber]),
    );
    for (const heat of heats.race.heats) {
        const occupied = heat.lanes.filter(
            (lane: { racerId: number | null }) => lane.racerId !== null,
        );
        if (occupied.length === 0) continue;
        const timed = occupied.map((lane: { lane: number; racerId: number }) => ({
            lane: lane.lane,
            racerId: lane.racerId,
            time: 3.1 + (carNumber.get(lane.racerId) ?? 0) / 100,
        }));
        const order = [...timed].sort((a, b) => a.time - b.time);
        const place = new Map(order.map((lane, index) => [lane.lane, index + 1]));
        await gql(
            page,
            `mutation SheetResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            {
                heatId: heat.id,
                lanes: timed.map((lane) => ({ ...lane, place: place.get(lane.lane)! })),
            },
        );
    }
    await gql(
        page,
        `mutation SheetAward($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        {
            raceId,
            award: { name: 'Fastest Car', kind: 'SPEED', source: 'PACK', place: 1 },
        },
    );

    await page.goto(`/race/${raceId}/print/results`);
    await expect(page.getByTestId('results-sheet')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'results-sheet.png') });
});
