/**
 * A race with no recorded time anywhere is a first-class configuration
 * (#1329) — the Displays picker no longer offers a view whose time column
 * can never fill in, and the Stats page says so rather than rendering a
 * table of dashes.
 *
 * `displayView.test.ts`/`DisplaysPanel.test.tsx` cover `viewOptionsFor`'s
 * own filter in isolation, and `RaceStats.test.tsx` covers the Lane
 * Fairness/Top Moments empty states against a mocked payload. Neither can
 * see the one thing this issue is actually about: a *pure* `POINTS` race —
 * every heat recorded with a place and no time, on a track with no
 * electronic timer — read back through a real GraphQL round trip and a
 * real `Race.hasRecordedTimes`/`RaceStats.hasRecordedTimes` computed
 * server-side.
 */

import { test, expect, type Page } from '@playwright/test';
import { attemptId, attemptSuffix, ensureConfigured, gql } from './support';

/** The display's own storage key (`displays.spec.ts` uses the same one). */
const STORAGE_KEY = 'trustytrack.displayId';

async function openDisplay(page: Page, raceId: number, id: string) {
    await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [STORAGE_KEY, id],
    );
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');
}

interface Lane {
    lane: number;
    racerId: number | null;
    placeholderSlot: number | null;
    time: number | null;
    place: number | null;
    skipped: boolean;
}

interface Heat {
    id: number;
    lanes: Lane[];
}

test('a pure-places race on a no-timer track: the Displays picker drops last heat\'s times and cycle, and the Stats page says why', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);

    // A track of its own, with no electronic timer — the same shape
    // `noTimerScoringNote.spec.ts` builds, since tracks are global state
    // shared across every spec in this suite (#1318).
    const trackName = `E2E No-Times Track${attemptSuffix()}`;
    const trackData = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation NoTimesTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: trackName, laneCount: 4, timerType: 'NONE' } },
    );
    const trackId = trackData.createTrack.id;

    const config = await gql<{ organizations: { id: number }[] }>(
        page,
        `query { organizations { id } }`,
    );

    const raceName = `No Recorded Times Race${attemptSuffix()}`;
    const raceData = await gql<{ createRace: { id: number } }>(
        page,
        `mutation NoTimesRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: raceName,
                organizationId: config.organizations[0].id,
                trackId,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'POINTS',
            },
        },
    );
    const raceId = raceData.createRace.id;

    // Four racers, checked in — a full four-lane heat on this track.
    const racers = [
        { firstName: 'Ada', lastName: 'Ant', carNumber: 1 },
        { firstName: 'Ben', lastName: 'Bear', carNumber: 2 },
        { firstName: 'Cy', lastName: 'Cat', carNumber: 3 },
        { firstName: 'Dee', lastName: 'Deer', carNumber: 4 },
    ];
    for (const racer of racers) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation NoTimesRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId, ...racer } },
        );
        await gql(
            page,
            `mutation NoTimesCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
    }

    await gql(
        page,
        `mutation NoTimesSchedule($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        { raceId, config: { generalRound: { type: 'ALL', runsPerLane: 1 }, championshipRounds: [] } },
    );

    const heatsData = await gql<{ race: { heats: Heat[] } }>(
        page,
        `query NoTimesHeats($raceId: Int!) {
            race(raceId: $raceId) {
                id
                heats { id lanes { lane racerId placeholderSlot time place skipped } }
            }
        }`,
        { raceId },
    );
    const heat = heatsData.race.heats[0];
    expect(heat).toBeTruthy();

    // Record it: a place for every occupied lane, no time on any of them —
    // exactly the "heats run with places and no times" case the issue is
    // about. `updateHeatResult` needs the whole stored lane set resent.
    const occupied = heat.lanes.filter((l) => l.racerId !== null);
    await gql(
        page,
        `mutation NoTimesRecord($heatId: Int!, $lanes: [HeatLaneInput!]!) {
            updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
        }`,
        {
            heatId: heat.id,
            lanes: heat.lanes.map((lane) => {
                const index = occupied.findIndex((o) => o.lane === lane.lane);
                return {
                    lane: lane.lane,
                    racerId: lane.racerId,
                    placeholderSlot: lane.placeholderSlot,
                    time: null,
                    place: lane.racerId !== null ? index + 1 : null,
                };
            }),
        },
    );

    // A display, connected, so the Displays panel's own row exists to check.
    const id = attemptId('spec-no-times-display');
    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, id);

    await page.goto(`/race/${raceId}/displays`);
    const row = page.getByTestId(`display-${id}`);
    await expect(row).toBeVisible();

    const select = row.getByRole('combobox');
    const optionLabels = await select.locator('option').allTextContents();
    expect(optionLabels).not.toContain("Last heat's times");
    expect(optionLabels).not.toContain('Cycle between both');
    // Standings — always offered — is still there, so this isn't an empty
    // or broken select.
    expect(optionLabels).toContain('Standings');

    await displayContext.close();

    // The Stats page: Lane Fairness says it needs recorded times, with its
    // own heading still on screen, rather than a table of dashes.
    await page.goto(`/race/${raceId}/stats`);
    await expect(page.getByRole('heading', { name: 'Lane Fairness' })).toBeVisible();
    await expect(page.getByText(/Lane Fairness needs recorded times/)).toBeVisible();
    await expect(page.getByText('Advantage %')).not.toBeVisible();
});
