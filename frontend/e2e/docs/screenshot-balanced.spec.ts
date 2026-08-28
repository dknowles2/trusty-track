/**
 * Screenshots of balanced racing, for docs/race-day.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-balanced.spec.ts
 *
 * The dialog is photographed first; then the first phase is raced through
 * the API so the schedule picture shows the thing the method is about — the
 * next set of heats appearing with the winners matched against each other.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, gql, groupId } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');

const DENS = [
    { name: 'Wolves', color: '#8B4513', rank: 'WOLF' },
    { name: 'Bears', color: '#1E5631', rank: 'BEAR' },
];

// Listed strongest first: whoever appears earlier wins any heat they share,
// which makes the phase-two matchups assertable rather than hoped for.
const RACERS = [
    { first: 'Ada', last: 'Lovelace', car: 3, name: 'Blue Streak', den: 'Bears' },
    { first: 'Katherine', last: 'Johnson', car: 14, name: 'Red Comet', den: 'Bears' },
    { first: 'Grace', last: 'Hopper', car: 7, name: 'Thunderbolt', den: 'Wolves' },
    { first: 'Alan', last: 'Turing', car: 11, name: 'Silver Arrow', den: 'Wolves' },
    { first: 'Chien-Shiung', last: 'Wu', car: 22, name: 'Green Machine', den: 'Bears' },
    { first: 'Mae', last: 'Jemison', car: 18, name: 'Night Owl', den: 'Wolves' },
    { first: 'Dorothy', last: 'Vaughan', car: 5, name: 'Purple Flash', den: 'Bears' },
    { first: 'Hedy', last: 'Lamarr', car: 9, name: 'Star Chaser', den: 'Wolves' },
];

test('screenshot balanced racing', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);

    const raceGroupId = await groupId(page);
    const raceTrackId = await docsTrackId(page);

    const race = await gql(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Pack 42 Balanced Night',
                dateTime: '2026-03-14T09:30:00',
                location: 'St Anne’s Parish Hall',
                groupId: raceGroupId,
                trackId: raceTrackId,
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
        strength.push(created.createRacer.id);
    }

    // The dialog, set to balanced — the control the guide points at.
    await page.goto(`/race/${raceId}/control`);
    await page.getByRole('button', { name: 'Add Round' }).click();
    await page
        .getByLabel('Balanced — each round of heats matches cars doing about as well')
        .check();
    await expect(page.getByLabel('Round Name')).toHaveValue('Balanced Round');
    // Let the dialog's fade-in finish; a mid-fade screenshot washes out.
    await page.waitForTimeout(400);
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '29-balanced-dialog.png'),
    });

    await page.getByRole('button', { name: 'Create Round(s) & Generate Heats' }).click();
    await expect(page.getByText('Balanced Round').first()).toBeVisible();

    // Race the first phase through the API; the second appears on its own,
    // with the two phase-one winners matched against each other.
    const scheduled = await gql(
        page,
        `query Heats($raceId: Int!) {
            race(raceId: $raceId) { heats { id lanes { lane racerId time place } } }
        }`,
        { raceId },
    );
    const phaseOneWinners: number[] = [];
    for (const heat of scheduled.race.heats) {
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
        // order[0] is strongest present, so lowest time, so place 1 — the heat's winner.
        phaseOneWinners.push(order[0].racerId);
        await gql(
            page,
            `mutation Result($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes },
        );
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    // Phase two exists: heats without times below the recorded ones.
    const grown = await gql(
        page,
        `query Heats($raceId: Int!) {
            race(raceId: $raceId) { heats { id lanes { racerId time } } }
        }`,
        { raceId },
    );
    const pending = grown.race.heats.filter(
        (heat: { lanes: { time: number | null }[] }) =>
            !heat.lanes.some((lane) => lane.time !== null),
    );
    expect(pending.length).toBeGreaterThan(0);
    await expect(page.getByText('Heat 3')).toBeVisible();
    // The caption's claim: the phase-one winners are matched against each
    // other in the first phase-two heat, not scattered across the field.
    const firstPendingRacerIds = pending[0].lanes.map(
        (lane: { racerId: number | null }) => lane.racerId,
    );
    for (const winner of phaseOneWinners) {
        expect(firstPendingRacerIds).toContain(winner);
    }
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '30-balanced-schedule.png'),
        fullPage: false,
    });
});
