/**
 * Stats on a phone (#1147).
 *
 * Three things, all found at 390×844 on `main`: the Per-Racer Stats table
 * was 534px wide with Avg and Max off-screen; each Track Record row was
 * ~90px tall, mostly from a "Race" column wrapping the race's name across
 * up to four lines while every row also carried a "THIS EVENT" badge; and
 * the Lane Fairness / Dens Comparison charts skipped alternate axis
 * labels, so a 4-lane chart read "Lane 2 · Lane 4" with lanes 1 and 3
 * unlabelled.
 */

import { expect, test } from '@playwright/test';

import {
    RACERS,
    createSchedule,
    ensureConfigured,
    gql,
    readHeats,
    recordRound,
    type SeededRacer,
} from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * A race on a track this spec owns outright, rather than `seedRace`'s
 * shared per-worker pool.
 *
 * Track Record reads every race ever run on a track (`.claude/rules/
 * scoring.md`'s "computed on every read" section), so on the shared pool
 * whether every record on the list belongs to *this* race — the exact
 * condition `hideRaceColumn` switches on (#1147) — depends on which other
 * specs happened to run on the same track first, in the same suite run.
 * `frontend/e2e/docs/support.ts`'s `ownTrack` exists for the identical
 * reason; this is the same idea kept local to the functional suite rather
 * than reaching across to the docs one.
 */
async function seedOwnRaceAndTrack(
    page: Parameters<typeof gql>[0],
    name: string,
): Promise<{ raceId: number; laneCount: number; racers: SeededRacer[] }> {
    await ensureConfigured(page);

    const laneCount = 4;
    const track = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: `${name} Track`, laneCount, timerType: 'FAKE' } },
    );

    const config = await gql<{ organizations: { id: number }[] }>(
        page,
        `query { organizations { id } }`,
    );

    const created = await gql<{ createRace: { id: number } }>(
        page,
        `mutation($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name,
                organizationId: config.organizations[0].id,
                trackId: track.createTrack.id,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'TIMED',
            },
        },
    );
    const raceId = created.createRace.id;

    const racers: SeededRacer[] = [];
    for (const racer of RACERS) {
        const result = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId, ...racer } },
        );
        await gql(
            page,
            `mutation($id: Int!) { checkInRacer(id: $id, passedInspection: true, weight: null) { id } }`,
            { id: result.createRacer.id },
        );
        racers.push({ id: result.createRacer.id, ...racer });
    }

    return { raceId, laneCount, racers };
}

test('the per-racer Avg cell is on screen, track-record rows are short, and the lane chart labels every lane, on a 390px phone (#1147)', async ({
    page,
}) => {
    const { raceId, racers, laneCount } = await seedOwnRaceAndTrack(page, 'Mobile Stats Layout ' + Date.now());
    await createSchedule(page, raceId);

    // Six distinct car times (`recordRound`'s own `3.0 + n/100` rule) give
    // the track up to five distinct per-racer bests — enough for the
    // all-time Track Record table (rendered only once there is more than
    // one entry) as well as real Per-Racer Stats and Lane Fairness rows.
    // Every one of them belongs to this race, since the track is this
    // spec's own — the condition the Race-column assertion below depends on.
    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/stats`);
    await page.waitForLoadState('networkidle');

    // --- Per-Racer Stats: the Avg cell must be on screen. -----------------
    const perRacerSection = page.locator('.race-stats__section', { hasText: 'Per-Racer Stats' });
    await expect(perRacerSection).toBeVisible();
    const avgHeader = perRacerSection.getByRole('columnheader', { name: /^Avg/ });
    await expect(avgHeader).toBeVisible();
    const avgHeaderBox = await avgHeader.boundingBox();
    expect(avgHeaderBox).not.toBeNull();
    expect(avgHeaderBox!.x + avgHeaderBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // The row's own <td> order never changes with width — only which of
    // them are `display: none` (#, Name, Den, Heats, Min, Avg, Max, Std
    // Dev) — so Avg is reliably the 6th cell (index 5) whether or not the
    // hidden ones are still in the DOM.
    const firstDataRow = perRacerSection.locator('tbody tr').first();
    const avgCell = firstDataRow.locator('td').nth(5);
    await expect(avgCell).toBeVisible();
    const avgCellBox = await avgCell.boundingBox();
    expect(avgCellBox).not.toBeNull();
    expect(avgCellBox!.x + avgCellBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    expect(avgCellBox!.x).toBeGreaterThanOrEqual(0);

    // The document itself must not be forced wider than the phone.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // {group} (Den), Min, Max and Std Dev are dropped at this width —
    // unreachable by role, the same "hidden, not merely scrolled" check
    // `mobileStandingsScore.spec.ts` uses for Standings. Anchored regexes
    // rather than exact strings, since the accessible name carries the
    // sort indicator too ("Min ↕").
    await expect(perRacerSection.getByRole('columnheader', { name: 'Den' })).toHaveCount(0);
    await expect(perRacerSection.getByRole('columnheader', { name: /^Min/ })).toHaveCount(0);
    await expect(perRacerSection.getByRole('columnheader', { name: /^Max/ })).toHaveCount(0);
    await expect(perRacerSection.getByRole('columnheader', { name: /Std Dev/ })).toHaveCount(0);

    // --- Track Record: every row under 60px tall. --------------------------
    const trackRecordSection = page.getByTestId('track-record-section');
    await expect(trackRecordSection).toBeVisible();
    const recordRows = trackRecordSection.locator('table tbody tr');
    const rowCount = await recordRows.count();
    expect(rowCount).toBeGreaterThan(0);
    for (let i = 0; i < rowCount; i++) {
        const box = await recordRows.nth(i).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height, `track record row ${i} is taller than 60px`).toBeLessThan(60);
    }
    // A fresh race, on a track this spec owns outright: every record was
    // set here, so the Race column is gone entirely rather than repeating
    // what the "This event"/"Set at this event!" badges already say.
    // `exact: true` — a plain `{ name: 'Race' }` also matches "Racer"
    // (Playwright's role-name matching is a substring by default).
    await expect(
        trackRecordSection.getByRole('columnheader', { name: 'Race', exact: true }),
    ).toHaveCount(0);

    // --- Lane Fairness: one tick per lane. ---------------------------------
    const laneSection = page.locator('.race-stats__section', { hasText: 'Lane Fairness' });
    const laneTicks = laneSection.locator('.recharts-cartesian-axis.xAxis .recharts-cartesian-axis-tick');
    await expect(laneTicks).toHaveCount(laneCount);
    // Short labels ("L1"–"L4") at this width, not the full "Lane 1" that
    // does not fit four-abreast on a 390px chart.
    await expect(laneSection.getByText('L1', { exact: true })).toBeVisible();

    // The Lane column of the table underneath does not wrap "Lane / 1".
    const laneCell = laneSection.locator('td', { hasText: 'Lane 1' }).first();
    const laneCellBox = await laneCell.boundingBox();
    expect(laneCellBox).not.toBeNull();
    // A single-line cell (padding plus one line of 0.9rem text) measures
    // about 32px; a wrapped "Lane / 1" was roughly double that.
    expect(laneCellBox!.height).toBeLessThan(40);
});
