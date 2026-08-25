/**
 * Screenshots of the Slowest Race bracket, for docs/race-day.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-slowest-race.spec.ts
 *
 * Races a full preliminary round through the API first, because both pictures
 * are about what happens *after* the standings exist: the add-round dialog is
 * choosing from them, and the standings page is reading them slowest-first.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');
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

// Listed fastest first: the times below are assigned in this order, so the
// three at the bottom are the field the Slowest Race picks — which is what
// lets the standings screenshot be asserted rather than hoped for.
const DENS = [
    { name: 'Wolves', color: '#8B4513', rank: 'WOLF' },
    { name: 'Bears', color: '#1E5631', rank: 'BEAR' },
];

const RACERS = [
    { first: 'Ada', last: 'Lovelace', car: 3, name: 'Blue Streak', den: 'Bears' },
    { first: 'Katherine', last: 'Johnson', car: 14, name: 'Red Comet', den: 'Bears' },
    { first: 'Grace', last: 'Hopper', car: 7, name: 'Thunderbolt', den: 'Wolves' },
    { first: 'Alan', last: 'Turing', car: 11, name: 'Silver Arrow', den: 'Wolves' },
    { first: 'Chien-Shiung', last: 'Wu', car: 22, name: 'Green Machine', den: 'Bears' },
    { first: 'Mae', last: 'Jemison', car: 18, name: 'Night Owl', den: 'Wolves' },
];

test('screenshot the slowest race bracket', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

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
                name: 'Pack 42 Turtle Night',
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

    const denIds: Record<string, number> = {};
    for (const den of DENS) {
        const created = await gql(
            page,
            `mutation Den($raceId: Int!, $den: DenInput!) { createDen(raceId: $raceId, den: $den) { id } }`,
            { raceId, den },
        );
        denIds[den.name] = created.createDen.id;
    }

    const racerIds: Record<number, number> = {};
    for (const racer of RACERS) {
        const created = await gql(
            page,
            `mutation Racer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    denId: denIds[racer.den],
                    firstName: racer.first,
                    lastName: racer.last,
                    carNumber: racer.car,
                    carName: racer.name,
                    carPassedInspection: true,
                },
            },
        );
        racerIds[racer.car] = created.createRacer.id;
    }

    // A raced preliminary round, through the API rather than the fake timer:
    // this spec is about the bracket, and driving a heat is race-day's job.
    await gql(
        page,
        `mutation Round($raceId: Int!, $config: WizardConfigurationInput!) {
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
    const scheduled = await gql(
        page,
        `query Heats($raceId: Int!) {
            race(raceId: $raceId) { heats { id lanes { lane racerId } } }
        }`,
        { raceId },
    );

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

    // The add-round dialog, set to the slowest cars — the control the guide
    // is pointing the reader at.
    await page.goto(`/race/${raceId}/control`);
    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByText('Championship Round', { exact: true }).click();
    await page.getByLabel('The slowest cars').check();
    await expect(page.getByLabel('Round Name')).toHaveValue('Slowest Race');
    // The dialog fades in over 200ms; a screenshot taken mid-fade washes
    // every color out against the blurred backdrop.
    await page.waitForTimeout(400);
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '25-slowest-race-dialog.png'),
    });

    await page.getByRole('button', { name: 'Create Round(s) & Generate Heats' }).click();
    // The prelims are finished, so the bracket fills straight away; the
    // slowest car is in it, the fastest is not.
    await expect(page.getByText('Slowest Race').first()).toBeVisible();

    // Race the bracket too — its standings view has nothing to show until it
    // has times, and an empty table is not the picture the guide needs.
    const rounds = await gql(
        page,
        `query Rounds($raceId: Int!) { rounds(raceId: $raceId) { id name } }`,
        { raceId },
    );
    const bracketId = rounds.rounds.find(
        (round: { name: string | null }) => round.name === 'Slowest Race',
    ).id;
    const bracketHeats = await gql(
        page,
        `query Heats($raceId: Int!) {
            race(raceId: $raceId) { heats { id roundId lanes { lane racerId } } }
        }`,
        { raceId },
    );
    for (const heat of bracketHeats.race.heats.filter(
        (h: { roundId: number | null }) => h.roundId === bracketId,
    )) {
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

    // The standings page reading the round the way the room does — slowest
    // first, with the line that says so.
    await page.goto(`/race/${raceId}/standings`);
    await page.getByLabel('Standings scope').selectOption({ label: 'Slowest Race' });
    await expect(
        page.getByText('Slowest car first — the last one down the track wins.'),
    ).toBeVisible();
    // Rank 1 is the slowest car of the six, not the fastest of the bracket.
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toContainText('Mae Jemison');
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '26-slowest-race-standings.png'),
    });
});
