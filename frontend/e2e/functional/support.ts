/**
 * Shared setup for the functional end-to-end specs.
 *
 * These specs share one backend, so everything here is written to be safe to
 * call from several specs in one run: race names are supplied by the caller
 * (`races.name` is unique), no spec assumes its race is id 1, and the first-run
 * gate is only there for whichever spec happens to go first.
 *
 * Setup goes through GraphQL rather than through the UI. What each spec is
 * testing is the one step it drives with a browser; getting a race and a
 * roster in place is not that step, and doing it by clicking makes a failure
 * anywhere in the app look like a failure of the thing under test.
 */

import { expect, type Page } from '@playwright/test';

export const BACKEND_URL = 'http://127.0.0.1:8002';

export interface Lane {
    lane: number;
    racerId: number | null;
    placeholderSlot: number | null;
    time: number | null;
    place: number | null;
    skipped: boolean;
}

export interface Heat {
    id: number;
    roundId: number | null;
    heatNumber: number;
    lanes: Lane[];
}

export interface SeededRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber: number;
}

export interface SeededRace {
    raceId: number;
    trackId: number;
    laneCount: number;
    racers: SeededRacer[];
}

export async function gql<T = unknown>(
    page: Page,
    query: string,
    variables: Record<string, unknown> = {},
): Promise<T> {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

/** Get past the first-run gate, if this is the spec that arrives first. */
export async function ensureConfigured(page: Page): Promise<void> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill('Pack 42');
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }
}

/** Six racers whose ranking is decided by car number.
 *
 * `recordRound` gives car *n* a time of `3.0 + n/100` in every heat it runs, so
 * the standings come out in car-number order however the scheduler happens to
 * distribute them. That is what lets a test name the racers it expects to
 * advance instead of reading them back out of the thing it is checking.
 */
export const RACERS = [
    { firstName: 'Ada', lastName: 'Ant', carNumber: 1 },
    { firstName: 'Ben', lastName: 'Bear', carNumber: 2 },
    { firstName: 'Cy', lastName: 'Cat', carNumber: 3 },
    { firstName: 'Dee', lastName: 'Deer', carNumber: 4 },
    { firstName: 'Eli', lastName: 'Elk', carNumber: 5 },
    { firstName: 'Fay', lastName: 'Fox', carNumber: 6 },
];

/** A race with a checked-in roster, ready for a schedule.
 *
 * Racers are checked in because `generate_heats_for_round` fields only racers
 * that passed inspection — an uninspected roster produces an empty schedule
 * rather than an error, which is a confusing way for a spec to fail.
 */
export async function seedRace(page: Page, name: string): Promise<SeededRace> {
    await ensureConfigured(page);

    const config = await gql<{
        groups: { id: number }[];
        tracks: { id: number; laneCount: number }[];
    }>(page, `query { groups { id } tracks { id laneCount } }`);
    const track = config.tracks[0];

    const created = await gql<{ createRace: { id: number } }>(
        page,
        `mutation SeedRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name,
                groupId: config.groups[0].id,
                trackId: track.id,
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
            `mutation SeedRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId, ...racer } },
        );
        await gql(
            page,
            `mutation SeedCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: result.createRacer.id },
        );
        racers.push({ id: result.createRacer.id, ...racer });
    }

    return { raceId, trackId: track.id, laneCount: track.laneCount, racers };
}

/** One preliminary round, optionally followed by a championship round. */
export async function createSchedule(
    page: Page,
    raceId: number,
    championship?: { name: string; numTopRacers: number },
): Promise<void> {
    await gql(
        page,
        `mutation SeedSchedule($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        {
            raceId,
            config: {
                generalRound: { type: 'PACK', runsPerLane: 1 },
                championshipRounds: championship
                    ? [
                          {
                              name: championship.name,
                              source: 'PACK',
                              numTopRacers: championship.numTopRacers,
                              runsPerLane: 1,
                          },
                      ]
                    : [],
            },
        },
    );
}

export async function readRounds(
    page: Page,
    raceId: number,
): Promise<{ id: number; roundNumber: number; advancementSource: string | null }[]> {
    const data = await gql<{
        rounds: { id: number; roundNumber: number; advancementSource: string | null }[];
    }>(
        page,
        `query ReadRounds($raceId: Int!) {
            rounds(raceId: $raceId) { id roundNumber advancementSource }
        }`,
        { raceId },
    );
    return data.rounds;
}

export async function readHeats(page: Page, raceId: number): Promise<Heat[]> {
    const data = await gql<{ race: { heats: Heat[] } }>(
        page,
        `query ReadHeats($raceId: Int!) {
            race(raceId: $raceId) {
                id
                heats {
                    id
                    roundId
                    heatNumber
                    lanes { lane racerId placeholderSlot time place skipped }
                }
            }
        }`,
        { raceId },
    );
    return data.race.heats;
}

/** Record every heat of a round, ranking racers by car number.
 *
 * Car *n* runs `3.0 + n/100` wherever it appears, so the aggregate standings
 * are the car numbers in ascending order and a test can say who should be on
 * top without consulting the leaderboard it is about to assert on.
 */
export async function recordRound(
    page: Page,
    heats: Heat[],
    racers: SeededRacer[],
): Promise<void> {
    const carNumber = new Map(racers.map((r) => [r.id, r.carNumber]));

    for (const heat of heats) {
        const occupied = heat.lanes.filter((l) => l.racerId !== null);
        if (occupied.length === 0) continue;

        const timed = occupied.map((lane) => ({
            ...lane,
            time: 3.0 + carNumber.get(lane.racerId!)! / 100,
        }));
        const ordered = [...timed].sort((a, b) => a.time - b.time);
        const place = new Map(ordered.map((lane, idx) => [lane.lane, idx + 1]));

        await gql(
            page,
            `mutation RecordHeat($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            {
                heatId: heat.id,
                lanes: timed.map((lane) => ({
                    lane: lane.lane,
                    racerId: lane.racerId,
                    placeholderSlot: lane.placeholderSlot,
                    time: lane.time,
                    place: place.get(lane.lane)!,
                })),
            },
        );
    }
}

/** Close the round summary if it is up.
 *
 * It appears whenever a championship round's field is decided, and it is modal
 * — leaving it up sends every later click to its backdrop instead of the page.
 */
export async function dismissRoundSummary(page: Page): Promise<void> {
    const summary = page.getByRole('dialog', { name: 'Round Complete!' });
    if (await summary.isVisible()) {
        await summary.getByRole('button', { name: '×' }).click();
        await expect(summary).toBeHidden();
    }
}
