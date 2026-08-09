/**
 * Screenshots of Free Race, for docs/free-race.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-free-race.spec.ts
 *
 * Builds its own race with its own fake-timer track, so the mole appears and
 * a heat can actually be run start to finish without hardware.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/free-race');
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

const RACERS = [
    { first: 'Alex', last: 'Rivera', car: 3, name: 'Blue Streak' },
    { first: 'Sam', last: 'Okafor', car: 7, name: 'Thunderbolt' },
    { first: 'Jordan', last: 'Chen', car: 11, name: 'Silver Arrow' },
    { first: 'Riley', last: 'Novak', car: 14, name: 'Red Comet' },
    { first: 'Casey', last: 'Ahmed', car: 18, name: 'Night Owl' },
    { first: 'Morgan', last: 'Silva', car: 22, name: 'Green Machine' },
];

test('screenshot free race', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill('Pack 42');
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }

    const config = await gql(page, `query { groups { id } }`);
    // Its own track, created through the API so the backend spins up a timer
    // manager for it — that is what puts the fake timer mole on screen.
    const track = await gql(
        page,
        `mutation Track($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: 'Free Race Track', laneCount: 4, timerType: 'FAKE' } },
    );

    const race = await gql(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                // Not the same name the printables spec uses: `races.name` is
                // unique, and running every docs spec in one go shares one
                // backend, so a shared name makes whichever runs second fail.
                name: 'Pack 42 Free Race Night',
                dateTime: '2026-03-14T09:30:00',
                location: 'St Anne’s Parish Hall',
                groupId: config.groups[0].id,
                trackId: track.createTrack.id,
                scoringStrategy: 'TIMED',
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
                    carName: racer.name,
                    // Only checked-in racers can be put in a lane.
                    carPassedInspection: true,
                },
            },
        );
    }

    await page.goto(`/race/${raceId}/control/free-race`);
    await expect(page.getByText('Free Race Setup')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-lane-setup-random.png') });

    await page.getByRole('button', { name: /Manual/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-lane-setup-manual.png') });

    // Back to Random so the heat has a full field of named racers.
    await page.getByRole('button', { name: /Random/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Start Free Race Heat/ }).click();
    await expect(page.getByText('Free Race Heat')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-heat-armed.png') });

    // The fake timer mole: arm, then finish, which records times.
    await page.getByRole('button', { name: /Start Timer/ }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Finish Heat/ }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-heat-results.png') });
});
