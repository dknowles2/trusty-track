/**
 * The Race Stats screenshots, for docs/race-stats.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-race-stats.spec.ts
 *
 * Split out of `race-day.spec.ts`, which drove a whole event through the
 * browser and photographed the Stats page at the end. Nothing here needs the
 * driving — only a race with results — so it seeds one through the API and runs
 * beside the race-day chain rather than behind it.
 *
 * It races on a **track of its own**, because the record board is the fastest
 * cars the *track* has ever seen. On the shared track its content would depend
 * on which other specs had raced, which is precisely the churn the seeding work
 * exists to prevent — and it is what makes the section's caption ("every entry
 * is from this race") true rather than lucky.
 *
 * The roster comes from `populateRace` rather than being hand-written: the
 * per-racer table and the den comparison are pictures of a *pack*, and eight
 * names do not illustrate either.
 */

import { test, expect, jitter } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    type Heat,
    ensureConfigured,
    gql,
    ownTrack,
    readHeats,
    readRounds,
    runRoundWizard,
    seedRace,
} from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(
    __dirname,
    '../../../docs/assets/screenshots/race-stats',
);

/**
 * Record a heat with times that look unpatterned and are the same next time.
 *
 * The spread is per lane and the jitter is *derived* from the heat's position
 * rather than drawn: `Math.random()` here was the last thing making every
 * standings, stats and observation screenshot differ on every run. Keyed on the
 * position rather than the heat id, because ids depend on how many races the
 * specs running alongside this one happen to have created.
 */
async function recordWithSpread(page: import('@playwright/test').Page, heats: Heat[]) {
    for (const [position, heat] of heats.entries()) {
        const running = heat.lanes.filter((lane) => lane.racerId !== null);
        if (running.length === 0) continue;
        if (running.some((lane) => lane.time !== null)) continue;

        const timed = running.map((lane, index) => ({
            ...lane,
            time: 3.0 + index * 0.13 + jitter(`${position}:${lane.lane}`),
        }));
        timed.sort((a, b) => a.time - b.time);
        const lanes = timed
            .map((lane, index) => ({
                lane: lane.lane,
                racerId: lane.racerId,
                time: lane.time,
                place: index + 1,
            }))
            .sort((a, b) => a.lane - b.lane);

        await gql(
            page,
            `mutation StatsResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes },
        );
    }
}

test('screenshot the race stats page', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1200, height: 800 });
    await ensureConfigured(page);

    const trackId = await ownTrack(page, 'Race Stats Track');
    const raceId = await seedRace(page, {
        name: 'Pack 42 Stats Derby',
        trackId,
        dateTime: '2026-03-21T10:00:00',
        location: 'School Gym',
        carNumberingStrategy: 'GLOBAL',
    });

    // A believable pack, invented by the same generator the practice race uses
    // and made repeatable by `TRUSTYTRACK_DEMO_SEED`. Checked in as it is
    // built: `generate_heats_for_round` fields from `car_passed_inspection`.
    await gql(
        page,
        `mutation StatsRoster($raceId: Int!, $config: PopulateTestDataInput!) {
            populateRace(raceId: $raceId, config: $config)
        }`,
        {
            raceId,
            config: {
                count: 20,
                addRacerPhotos: true,
                addCarPhotos: true,
                assignDens: true,
                checkIn: true,
            },
        },
    );

    await runRoundWizard(page, raceId, { championshipRacers: 3 });
    const rounds = await readRounds(page, raceId);
    const prelim = rounds.find((round) => round.advancementSource === null)!;
    const championship = rounds.find((round) => round.advancementSource !== null);

    const heats = await readHeats(page, raceId);
    await recordWithSpread(
        page,
        heats.filter((heat) => heat.roundId === prelim.id),
    );

    // The final's field fills itself from the cascade, and is deliberately left
    // unraced: picture 08 is captioned "during an in-progress race, with the
    // Heats Completed card showing partial completion", and a race with every
    // heat behind it makes that caption false.
    if (championship) {
        await gql(
            page,
            `mutation StatsAdvance($raceId: Int!, $roundId: Int!) {
                advanceRound(raceId: $raceId, roundId: $roundId)
            }`,
            { raceId, roundId: championship.id },
        );
    }

    await page.goto(`/race/${raceId}/stats`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.race-stats__overview-cards')).toBeVisible();

    // 01: the full stats page, with the Stats tab highlighted in the nav.
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-stats-tab-nav.png') });

    // 02: the overview cards at the top of the page.
    const overviewCards = page.locator('.race-stats__overview-cards');
    const overviewBox = await overviewCards.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '02-overview-cards.png'),
        ...(overviewBox
            ? { clip: { x: 0, y: overviewBox.y - 10, width: 1200, height: overviewBox.height + 20 } }
            : {}),
    });

    // 03: lane fairness.
    const laneSection = page.locator('.race-stats__section').first();
    await expect(laneSection).toBeVisible();
    await laneSection.scrollIntoViewIfNeeded();
    const laneBox = await laneSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '03-lane-fairness.png'),
        ...(laneBox
            ? { clip: { x: 0, y: laneBox.y - 10, width: 1200, height: laneBox.height + 20 } }
            : {}),
    });

    // 04: the per-racer table.
    const racerSection = page.locator('.race-stats__section').nth(1);
    await expect(racerSection).toBeVisible();
    await racerSection.scrollIntoViewIfNeeded();
    const racerBox = await racerSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '04-per-racer-stats.png'),
        ...(racerBox
            ? {
                  clip: {
                      x: 0,
                      y: racerBox.y - 10,
                      width: 1200,
                      height: Math.min(racerBox.height + 20, 600),
                  },
              }
            : {}),
    });

    // 05: the top-moments cards. Scoped to the Top Moments section — the Track
    // Record card below uses the same highlights grid, so the bare class
    // matches twice.
    const momentsSection = page
        .locator('.race-stats__section')
        .filter({ hasText: 'Top Moments' })
        .locator('.race-stats__highlights');
    await expect(momentsSection).toBeVisible();
    await momentsSection.scrollIntoViewIfNeeded();
    const momentsBox = await momentsSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '05-top-moments.png'),
        ...(momentsBox
            ? { clip: { x: 0, y: momentsBox.y - 40, width: 1200, height: momentsBox.height + 80 } }
            : {}),
    });

    // 09: the track record section — the fastest cars this track has ever
    // seen. This spec owns the track, so every entry is from this race and the
    // hero card carries its badge.
    const recordSection = page.getByTestId('track-record-section');
    await expect(recordSection).toBeVisible();
    await recordSection.scrollIntoViewIfNeeded();
    const recordBox = await recordSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '09-track-record.png'),
        ...(recordBox
            ? { clip: { x: 0, y: recordBox.y - 10, width: 1200, height: recordBox.height + 20 } }
            : {}),
    });

    // 06: den comparison.
    const denSection = page.locator('.race-stats__section').filter({ hasText: 'Den Comparison' });
    await expect(denSection).toBeVisible();
    await denSection.scrollIntoViewIfNeeded();
    const denBox = await denSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '06-den-comparison.png'),
        ...(denBox
            ? { clip: { x: 0, y: denBox.y - 10, width: 1200, height: denBox.height + 20 } }
            : {}),
    });

    // 07: the export buttons.
    const exportSection = page.locator('.race-stats__export-buttons');
    await expect(exportSection).toBeVisible();
    await exportSection.scrollIntoViewIfNeeded();
    const exportBox = await exportSection.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '07-export-buttons.png'),
        ...(exportBox
            ? {
                  clip: {
                      x: 0,
                      y: Math.max(0, exportBox.y - 50),
                      width: 1200,
                      height: exportBox.height + 100,
                  },
              }
            : {}),
    });

    // 08: the whole page.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(overviewCards).toBeVisible();
    // The caption's claim: an in-progress race, with the Heats Completed card
    // showing partial completion — not every heat run, and not none of them.
    const heatsCompletedText = await page
        .locator('.race-stats__overview-card-value')
        .nth(2)
        .innerText();
    const [completed, scheduled] = heatsCompletedText.split('/').map((n) => Number(n.trim()));
    expect(completed).toBeGreaterThan(0);
    expect(completed).toBeLessThan(scheduled);
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '08-stats-live-partial.png'),
        fullPage: true,
    });
});
