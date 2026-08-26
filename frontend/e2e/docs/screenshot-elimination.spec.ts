/**
 * Screenshots of elimination racing, for docs/race-day.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-elimination.spec.ts
 *
 * The dialog is photographed first, then the whole elimination is played
 * through the API — the schedule grows a wave at a time as results land, and
 * the standings picture needs the race decided so the loss counts mean
 * something.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCREENSHOT_BACKEND_URL } from '../environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');
const BACKEND_URL = SCREENSHOT_BACKEND_URL;

async function gql(page: Page, query: string, variables: Record<string, unknown> = {}) {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

// Listed strongest first: whoever appears earlier wins any heat they share,
// so Ada survives everything and Mae goes out first — which makes the
// standings picture assertable rather than hoped for.
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

test('screenshot elimination racing', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

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
                name: 'Pack 42 Elimination Night',
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
    const strength: number[] = [];
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
        strength.push(created.createRacer.id);
    }

    // The dialog, set to elimination — the control the guide points at.
    await page.goto(`/race/${raceId}/control`);
    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel("Elimination — lose too many heats and you're out").check();
    await expect(page.getByLabel('Round Name')).toHaveValue('Elimination Round');
    // Let the dialog's fade-in finish; a mid-fade screenshot washes out.
    await page.waitForTimeout(400);
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '27-elimination-dialog.png'),
    });

    await page.getByRole('button', { name: 'Create Round(s) & Generate Heats' }).click();
    await expect(page.getByText('Elimination Round').first()).toBeVisible();

    // Play the whole event through the API. Each recorded wave makes the
    // next appear; stronger cars (earlier in `strength`) always win.
    for (let safety = 0; safety < 20; safety++) {
        const scheduled = await gql(
            page,
            `query Heats($raceId: Int!) {
                race(raceId: $raceId) { heats { id lanes { lane racerId time place } } }
            }`,
            { raceId },
        );
        const pending = scheduled.race.heats.filter(
            (heat: { lanes: { racerId: number | null; time: number | null; place: number | null }[] }) =>
                heat.lanes.some((lane) => lane.racerId !== null) &&
                !heat.lanes.some((lane) => lane.time !== null || lane.place !== null),
        );
        if (pending.length === 0) break;
        for (const heat of pending) {
            const running = heat.lanes.filter(
                (lane: { racerId: number | null }) => lane.racerId !== null,
            );
            const order = [...running].sort(
                (a: { racerId: number }, b: { racerId: number }) =>
                    strength.indexOf(a.racerId) - strength.indexOf(b.racerId),
            );
            const lanes = running.map((lane: { lane: number; racerId: number }) => ({
                lane: lane.lane,
                racerId: lane.racerId,
                time: 3.05 + order.findIndex((other: { racerId: number }) => other.racerId === lane.racerId) * 0.14,
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
    }

    // The standings, read as losses: Ada never lost, everyone else is out.
    await page.goto(`/race/${raceId}/standings`);
    await page.getByLabel('Standings scope').selectOption({ label: 'Elimination Round' });
    await expect(page.getByText('Losses')).toBeVisible();
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toContainText('Ada Lovelace');
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '28-elimination-standings.png'),
    });
});
