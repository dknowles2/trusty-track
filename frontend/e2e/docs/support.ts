/**
 * What the documentation screenshot specs share.
 *
 * Nine of these files carried a private copy of `gql` and a private copy of
 * the first-run gate, which is why the backend URL could not be changed in one
 * place and why "seed through the API, drive the one screen under test with the
 * browser" had to be re-derived by every new spec. `e2e/functional/support.ts`
 * is the same idea for the functional suite.
 *
 * Two rules here are about running these specs *in parallel*, which they now
 * do (`workers` in `playwright.screenshots.config.ts`):
 *
 * **A track is global state; a race is not.** Every spec seeds its own race and
 * none may assume a race id. A spec that only needs somewhere to race uses
 * `docsTrackId` — the one track the first-run spec leaves behind. A spec whose
 * pictures depend on *track records* needs `ownTrack`, because a record is the
 * fastest car the track has ever seen and every other spec racing on the shared
 * track moves it.
 *
 * **Seeding is deterministic.** `recordEveryHeat` assigns times from a fixed
 * table rather than drawing them, for the reason `screenshots-setup.ts`
 * explains at length: a checked-in screenshot that differs on every run is not
 * a picture, it is a binary file that rewrites itself.
 */

import { expect, type Page } from '@playwright/test';
import { SCREENSHOT_BACKEND_URL } from '../environment';

export const BACKEND_URL = SCREENSHOT_BACKEND_URL;

/** The organization the first-run spec configures this install as. */
export const ORGANIZATION = 'Pack 42';

/** The track the first-run wizard creates, by the name its form defaults to. */
export const DOCS_TRACK_NAME = 'Main Track';

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
    lanes: Lane[];
}

export interface Round {
    id: number;
    roundNumber: number;
    advancementSource: string | null;
}

/**
 * Seed through the API; the browser is for the picture, not the setup.
 *
 * `T` defaults to `any` rather than to `unknown`, which is the opposite of
 * `e2e/functional/support.ts` and is deliberate: the functional specs reach
 * GraphQL through typed helpers and call this directly perhaps twice, where
 * every docs spec builds its own fixture out of raw queries. Pass a type when
 * you are writing a new one — the default is there so a picture-taking spec
 * does not have to restate a shape it uses once.
 */
export async function gql<T = any>(
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
    return body.data as T;
}

/**
 * Clear the first-run gate if it is still up.
 *
 * The `first-run` project is a Playwright *setup project*, so it runs before
 * every other project whatever is being filtered to — which means the gate is
 * normally gone by the time a spec starts. This stays because it costs one
 * request and because the alternative is nine specs that fail obscurely if the
 * project graph is ever edited.
 */
export async function ensureConfigured(page: Page): Promise<void> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill(ORGANIZATION);
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }
}

/** The shared track — somewhere to race, for a spec with no view on records. */
export async function docsTrackId(page: Page): Promise<number> {
    const config = await gql<{ tracks: Array<{ id: number; name: string }> }>(
        page,
        `query DocsTrack { tracks { id name } }`,
    );
    const track =
        config.tracks.find((candidate) => candidate.name === DOCS_TRACK_NAME) ??
        config.tracks[0];
    if (!track) throw new Error('No track exists; the first-run project did not run.');
    return track.id;
}

export async function groupId(page: Page): Promise<number> {
    const config = await gql<{ groups: Array<{ id: number }> }>(
        page,
        `query DocsGroup { groups { id } }`,
    );
    return config.groups[0].id;
}

/**
 * A track this spec owns, and nobody else writes to.
 *
 * For the pictures that are *about* track records — the record-break banner on
 * the audience displays, and the Stats page's record board. Both read the
 * fastest times the track has ever seen, across every race on it, so on the
 * shared track their content depends on which other specs have run. Delete it
 * with `deleteTrack` on the way out.
 */
export async function ownTrack(
    page: Page,
    name: string,
    laneCount = 4,
): Promise<number> {
    const created = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation OwnTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name, laneCount, timerType: 'FAKE' } },
    );
    return created.createTrack.id;
}

export async function deleteTrack(page: Page, trackId: number): Promise<void> {
    await gql(page, `mutation DropTrack($id: Int!) { deleteTrack(id: $id) }`, {
        id: trackId,
    });
}

export interface RaceSeed {
    name: string;
    trackId: number;
    dateTime?: string;
    location?: string;
    scoringStrategy?: string;
    carNumberingStrategy?: string;
}

/** A race of this spec's own. `races.name` is unique — never reuse one. */
export async function seedRace(page: Page, race: RaceSeed): Promise<number> {
    const created = await gql<{ createRace: { id: number } }>(
        page,
        `mutation SeedRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                scoringStrategy: 'TIMED',
                carNumberingStrategy: 'MANUAL',
                ...race,
                groupId: await groupId(page),
            },
        },
    );
    return created.createRace.id;
}

export interface DenSeed {
    name: string;
    color: string;
    rank?: string;
}

export async function seedDens(
    page: Page,
    raceId: number,
    dens: DenSeed[],
): Promise<Record<string, number>> {
    const ids: Record<string, number> = {};
    for (const den of dens) {
        const created = await gql<{ createDen: { id: number } }>(
            page,
            `mutation SeedDen($raceId: Int!, $den: DenInput!) {
                createDen(raceId: $raceId, den: $den) { id }
            }`,
            { raceId, den },
        );
        ids[den.name] = created.createDen.id;
    }
    return ids;
}

export interface RacerSeed {
    first: string;
    last: string;
    car: number;
    carName: string;
    den?: string;
}

/**
 * Checked in as they are created, because that is what makes them eligible for
 * a heat — `generate_heats_for_round` fields from `car_passed_inspection`.
 */
export async function seedRacers(
    page: Page,
    raceId: number,
    racers: RacerSeed[],
    denIds: Record<string, number> = {},
): Promise<Record<number, number>> {
    const ids: Record<number, number> = {};
    for (const racer of racers) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation SeedRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    denId: racer.den ? denIds[racer.den] : null,
                    firstName: racer.first,
                    lastName: racer.last,
                    carNumber: racer.car,
                    carName: racer.carName,
                    carPassedInspection: true,
                },
            },
        );
        ids[racer.car] = created.createRacer.id;
    }
    return ids;
}

/** The round wizard, through the API — one preliminary round and, optionally, a final. */
export async function runRoundWizard(
    page: Page,
    raceId: number,
    options: { championshipRacers?: number } = {},
): Promise<void> {
    const championshipRounds = options.championshipRacers
        ? [
              {
                  name: 'Championship Round',
                  source: 'PACK',
                  numTopRacers: options.championshipRacers,
                  runsPerLane: 1,
              },
          ]
        : [];
    await gql(
        page,
        `mutation SeedWizard($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        {
            raceId,
            config: {
                generalRound: { type: 'PACK', runsPerLane: 1 },
                championshipRounds,
            },
        },
    );
}

export async function readRounds(page: Page, raceId: number): Promise<Round[]> {
    const data = await gql<{ rounds: Round[] }>(
        page,
        `query SeedRounds($raceId: Int!) {
            rounds(raceId: $raceId) { id roundNumber advancementSource }
        }`,
        { raceId },
    );
    return data.rounds;
}

export async function readHeats(page: Page, raceId: number): Promise<Heat[]> {
    const data = await gql<{ race: { heats: Heat[] } }>(
        page,
        `query SeedHeats($raceId: Int!) {
            race(raceId: $raceId) {
                heats { id roundId lanes { lane racerId placeholderSlot time place skipped } }
            }
        }`,
        { raceId },
    );
    return data.race.heats;
}

/**
 * Record every unrun heat of `roundId`, giving each racer the same time in
 * every heat they appear in.
 *
 * A fixed time per *racer* rather than a spread per heat: under TIMED scoring
 * everybody runs the same number of heats, so a constant makes the standings
 * exactly the order `timeOf` was built in — which is what lets a spec assert
 * its winner rather than hope for one.
 */
export async function recordEveryHeat(
    page: Page,
    heats: Heat[],
    timeOf: Map<number, number>,
): Promise<void> {
    for (const heat of heats) {
        const running = heat.lanes.filter((lane) => lane.racerId !== null);
        if (running.length === 0) continue;
        if (running.some((lane) => lane.time !== null)) continue;
        const order = [...running].sort(
            (a, b) => timeOf.get(a.racerId!)! - timeOf.get(b.racerId!)!,
        );
        const lanes = running.map((lane) => ({
            lane: lane.lane,
            racerId: lane.racerId,
            time: timeOf.get(lane.racerId!)!,
            place: order.findIndex((other) => other.racerId === lane.racerId) + 1,
        }));
        await gql(
            page,
            `mutation SeedResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes },
        );
    }
}

/**
 * Race the whole event: the preliminary round, then the final if there is one.
 *
 * The final's field is filled by the advancement cascade the moment the
 * preliminaries complete, so `advanceRound` is a belt-and-braces call rather
 * than the mechanism — see `populate_round_if_decided`.
 */
export async function raceToFinish(
    page: Page,
    raceId: number,
    timeOf: Map<number, number>,
): Promise<void> {
    const rounds = await readRounds(page, raceId);
    const prelim = rounds.find((round) => round.advancementSource === null)!;
    const heats = await readHeats(page, raceId);
    await recordEveryHeat(
        page,
        heats.filter((heat) => heat.roundId === prelim.id),
        timeOf,
    );

    const championship = rounds.find((round) => round.advancementSource !== null);
    if (!championship) return;

    await gql(
        page,
        `mutation SeedAdvance($raceId: Int!, $roundId: Int!) {
            advanceRound(raceId: $raceId, roundId: $roundId)
        }`,
        { raceId, roundId: championship.id },
    );
    const withFinal = await readHeats(page, raceId);
    await recordEveryHeat(
        page,
        withFinal.filter((heat) => heat.roundId === championship.id),
        timeOf,
    );
}

/**
 * A historical record for this track, slower than anything `timeOf` produces.
 *
 * This is what makes the record-break banner fire deterministically: the
 * baseline is the record as it stood *before* today, so a track with no history
 * celebrates nothing rather than breaking the record on every fast heat.
 */
export async function seedHistoricalRecord(
    page: Page,
    trackId: number,
    timeSeconds: number,
): Promise<void> {
    await gql(
        page,
        `mutation SeedRecord($trackId: Int!, $record: HistoricalTrackRecordInput!) {
            createTrackRecord(trackId: $trackId, record: $record) { id }
        }`,
        {
            trackId,
            record: {
                timeSeconds,
                racerName: 'Marcus Reyes',
                carNumber: 27,
                raceName: 'Pinewood Derby 2019',
                raceDate: '2019-03-16',
            },
        },
    );
}

/**
 * Close the round summary if it is up.
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
