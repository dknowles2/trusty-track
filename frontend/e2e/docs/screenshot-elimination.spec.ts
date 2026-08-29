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

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, gql, organizationId } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');

// Listed strongest first: whoever appears earlier wins any heat they share,
// so Ada survives everything and Mae goes out first — which makes the
// standings picture assertable rather than hoped for.
const DENS = [
    { name: 'Wolves', color: '#8B4513', division: 'Wolf' },
    { name: 'Bears', color: '#1E5631', division: 'Bear' },
];

const RACERS = [
    { first: 'Ada', last: 'Lovelace', car: 3, name: 'Blue Streak', racingGroup: 'Bears' },
    { first: 'Katherine', last: 'Johnson', car: 14, name: 'Red Comet', racingGroup: 'Bears' },
    { first: 'Grace', last: 'Hopper', car: 7, name: 'Thunderbolt', racingGroup: 'Wolves' },
    { first: 'Alan', last: 'Turing', car: 11, name: 'Silver Arrow', racingGroup: 'Wolves' },
    { first: 'Chien-Shiung', last: 'Wu', car: 22, name: 'Green Machine', racingGroup: 'Bears' },
    { first: 'Mae', last: 'Jemison', car: 18, name: 'Night Owl', racingGroup: 'Wolves' },
];

test('screenshot elimination racing', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);

    const raceOrganizationId = await organizationId(page);
    const raceTrackId = await docsTrackId(page);

    const race = await gql(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Pack 42 Elimination Night',
                dateTime: '2026-03-14T09:30:00',
                location: 'St Anne’s Parish Hall',
                organizationId: raceOrganizationId,
                trackId: raceTrackId,
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

    const racerIds: Record<number, number> = {};
    const strength: number[] = [];
    for (const racer of RACERS) {
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
