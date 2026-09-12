/**
 * A track is shared across seasons (#994).
 *
 * Reproduces the issue directly: finish a race on a 3-lane track, shrink the
 * track to 2 lanes, and open that race's Schedule tab and heat sheet again.
 * `apply_outages_to_scheduled_heats`/`updateTrack` (#325) only rewrite a
 * round's *pending* heats to the smaller lane count — a recorded heat's
 * lanes are deliberately left alone — so both screens have to render a lane
 * the track no longer has rather than clip that lane's result off the page.
 * `laneColumnCount` in `features/racing/lanes.ts` is the fix both screens
 * share; this is the one check that nothing between the database and the
 * rendered page dropped it again.
 *
 * A track of its own, mirroring `timerModel.spec.ts`: this test shrinks a
 * track's lane count and does not put it back, and the shared per-worker
 * pool track (`configure.setup.ts`) is relied on by every other spec at its
 * original 4 lanes.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, readHeats, recordRound, RACERS, type SeededRacer } from './support';

test("a finished race's lane 3 result survives the track shrinking afterwards", async ({ page }) => {
    await ensureConfigured(page);

    const unique = `${test.info().parallelIndex}-${test.info().retry}-${Date.now()}`;
    const trackName = `Lane Shrink Track ${unique}`;

    const trackResult = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation CreateShrinkTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: trackName, laneCount: 3, timerType: 'FAKE' } },
    );
    const trackId = trackResult.createTrack.id;

    const config = await gql<{ organizations: { id: number }[] }>(
        page,
        `query { organizations { id } }`,
    );

    const raceResult = await gql<{ createRace: { id: number } }>(
        page,
        `mutation CreateShrinkRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: `Lane Shrink Race ${unique}`,
                organizationId: config.organizations[0].id,
                trackId,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'TIMED',
            },
        },
    );
    const raceId = raceResult.createRace.id;

    // Three racers on a three-lane track: every heat the wizard generates
    // fills every lane, so lane 3 is guaranteed a real result.
    const racers: SeededRacer[] = [];
    for (const racer of RACERS.slice(0, 3)) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation CreateShrinkRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId, ...racer } },
        );
        await gql(
            page,
            `mutation CheckInShrinkRacer($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
        racers.push({ id: created.createRacer.id, ...racer });
    }

    await gql(
        page,
        `mutation CreateShrinkSchedule($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        { raceId, config: { generalRound: { type: 'ALL', runsPerLane: 1 }, championshipRounds: [] } },
    );

    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    // Confirm the round actually holds a lane 3 result before the track
    // shrinks — otherwise this test would pass for the wrong reason.
    const recorded = await readHeats(page, raceId);
    const lane3 = recorded.flatMap((h) => h.lanes).find((l) => l.lane === 3 && l.time !== null);
    expect(lane3?.time).not.toBeNull();
    const lane3Time = lane3!.time!;

    // The exact step the issue's own repro takes in System Settings, done
    // here through the same mutation `updateTrack` sends.
    await gql(
        page,
        `mutation ShrinkTrack($id: Int!, $track: TrackInput!) { updateTrack(id: $id, track: $track) { id } }`,
        { id: trackId, track: { name: trackName, laneCount: 2, timerType: 'FAKE' } },
    );

    // The Schedule tab still shows lane 3's time.
    await page.goto(`/race/${raceId}/control`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Lane 3', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(`${lane3Time.toFixed(3)}s`).first()).toBeVisible();
    await expect(page.getByText('not on this track').first()).toBeVisible();

    // So does the printed heat sheet — it has no Result column by design
    // (issue #173), so the claim there is that lane 3's column, and the car
    // in it, is still on the page rather than clipped to the track's
    // current two lanes.
    await page.goto(`/race/${raceId}/print/heat-sheet`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Lane 3', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('not on this track').first()).toBeVisible();
});
