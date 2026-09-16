/**
 * The audience displays' phone tier (#1144) — a parent's phone, scanning
 * the Displays panel's own QR code, rather than a wall display or a
 * propped-up tablet. `displayDensity.ts`'s `phoneTier` (`< 600px`) switches
 * four surfaces to a `rem`-sized, scrolling, single-column layout:
 * `Observation.tsx`'s standard Live view, the check-in view, the
 * standings-only view, and `AwardCeremony.tsx`'s ceremony. This file is the
 * round trip a unit test cannot see — a real backend, a real layout, at
 * the exact viewport the issue reported (390×844) — checked against the
 * desktop width (1280×800) each view already had, to prove that width is
 * provably untouched.
 *
 * `displayResolutions.spec.ts` already sweeps 800/1024/1280/1920 — every
 * one of them at or above the phone tier's own 600px floor — so this file
 * does not repeat that sweep; it only adds the one tier below it.
 */

import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
import { BACKEND_URL } from './support';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

interface Racer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber: number;
}

interface Lane {
    lane: number;
    racerId: number | null;
    placeholderSlot: number | null;
    time: number | null;
    place: number | null;
    skipped: boolean;
}

interface HeatRow {
    id: number;
    heatNumber: number;
    recordedAt: string | null;
    lanes: Lane[];
}

async function gql<T = unknown>(
    request: APIRequestContext,
    query: string,
    variables: Record<string, unknown> = {},
): Promise<T> {
    const response = await request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

async function recordHeat(
    request: APIRequestContext,
    heat: HeatRow,
    carNumberById: ReadonlyMap<number, number>,
): Promise<void> {
    const occupied = heat.lanes.filter((l) => l.racerId !== null);
    if (occupied.length === 0) return;
    const timed = occupied.map((lane) => ({ ...lane, time: 3.0 + carNumberById.get(lane.racerId!)! / 100 }));
    const ordered = [...timed].sort((a, b) => a.time - b.time);
    const place = new Map(ordered.map((lane, idx) => [lane.lane, idx + 1]));
    const timeByLane = new Map(timed.map((lane) => [lane.lane, lane.time]));
    await gql(
        request,
        `mutation($heatId: Int!, $lanes: [HeatLaneInput!]!) { updateHeatResult(heatId: $heatId, lanes: $lanes) { id } }`,
        {
            heatId: heat.id,
            lanes: heat.lanes.map((lane) => ({
                lane: lane.lane,
                racerId: lane.racerId,
                placeholderSlot: lane.placeholderSlot,
                time: lane.racerId !== null ? timeByLane.get(lane.lane)! : null,
                place: lane.racerId !== null ? place.get(lane.lane)! : null,
            })),
        },
    );
}

async function readHeats(request: APIRequestContext, raceId: number): Promise<HeatRow[]> {
    const data = await gql<{ race: { heats: HeatRow[] } }>(
        request,
        `query($raceId: Int!) {
            race(raceId: $raceId) {
                heats { id heatNumber recordedAt lanes { lane racerId placeholderSlot time place skipped } }
            }
        }`,
        { raceId },
    );
    return [...data.race.heats].sort((a, b) => a.heatNumber - b.heatNumber);
}

interface SeededRace {
    raceId: number;
    racers: Racer[];
}

const FIRST_NAMES = ['Wren', 'Milo', 'Nadia', 'Otis', 'Priya', 'Quinn', 'Reid', 'Sana'];
const LAST_NAMES = ['Ashworth', 'Blackwood', 'Cortez', 'Delacroix', 'Ellery', 'Fenwick', 'Grantham', 'Halloway'];

/**
 * One race with results, an unfinished tail (so Now Racing / On Deck stay
 * populated), two racing groups with a den left partway through check-in
 * (so the check-in view has something to say), and a resolved SPEED award
 * (so the ceremony's first slide names a winner rather than "Still to be
 * decided" — the recipient text this file checks against the footer).
 */
async function seedRace(request: APIRequestContext): Promise<SeededRace> {
    const existing = await gql<{ organizations: { id: number }[] }>(request, `query { organizations { id } }`);
    if (existing.organizations.length === 0) {
        throw new Error(
            'No organization configured — run the full suite (configure.setup.ts) rather than this spec alone.',
        );
    }
    const organizationId = existing.organizations[0].id;

    const track = await gql<{ createTrack: { id: number } }>(
        request,
        `mutation($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: `Mobile Audience Track ${Date.now()}`, laneCount: 4, timerType: 'FAKE' } },
    );

    const race = await gql<{ createRace: { id: number } }>(
        request,
        `mutation($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: `Mobile Audience Race ${Date.now()}`,
                organizationId,
                trackId: track.createTrack.id,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'TIMED',
            },
        },
    );
    const raceId = race.createRace.id;

    const groupIds: number[] = [];
    for (const name of ['Wolves', 'Bears']) {
        const created = await gql<{ createRacingGroup: { id: number } }>(
            request,
            `mutation($raceId: Int!, $racingGroup: RacingGroupInput!) {
                createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
            }`,
            { raceId, racingGroup: { name, color: '#2E86C1', division: name } },
        );
        groupIds.push(created.createRacingGroup.id);
    }

    const racers: Racer[] = [];
    for (let i = 0; i < 8; i++) {
        const created = await gql<{ createRacer: { id: number } }>(
            request,
            `mutation($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    firstName: FIRST_NAMES[i],
                    lastName: LAST_NAMES[i],
                    carNumber: i + 1,
                    // First four Wolves, last four Bears — the Bears end up
                    // the den with pending racers below, deterministically.
                    racingGroupId: groupIds[i < 4 ? 0 : 1],
                },
            },
        );
        racers.push({ id: created.createRacer.id, firstName: FIRST_NAMES[i], lastName: LAST_NAMES[i], carNumber: i + 1 });
    }
    const carNumberById = new Map(racers.map((r) => [r.id, r.carNumber]));

    // The last two racers (both Bears) stay pending, so the check-in view's
    // "still to come" list has real content.
    for (const racer of racers.slice(0, -2)) {
        await gql(
            request,
            `mutation($id: Int!) { checkInRacer(id: $id, passedInspection: true, weight: null) { id } }`,
            { id: racer.id },
        );
    }

    await gql(
        request,
        `mutation($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        { raceId, config: { generalRound: { type: 'ALL', runsPerLane: 2 }, championshipRounds: [] } },
    );

    const heats = await readHeats(request, raceId);
    // Leave two heats unrecorded so Now Racing / On Deck stay populated.
    const toRecord = heats.slice(0, Math.max(0, heats.length - 2));
    for (const heat of toRecord) {
        await recordHeat(request, heat, carNumberById);
    }

    // A resolvable SPEED award (a winner falls out of the results already
    // recorded above), created first so the ceremony's opening slide names
    // it rather than the unresolved SPECIAL one below.
    await gql(
        request,
        `mutation($raceId: Int!, $award: AwardInput!) { createAward(raceId: $raceId, award: $award) { id } }`,
        { raceId, award: { name: 'Fastest Overall', kind: 'SPEED', source: 'OVERALL', place: 1 } },
    );
    await gql(
        request,
        `mutation($raceId: Int!, $award: AwardInput!) { createAward(raceId: $raceId, award: $award) { id } }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    return { raceId, racers };
}

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function overlaps(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function fontSizeOf(locator: Locator): Promise<number> {
    return locator.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.describe('the audience displays\' phone tier (#1144)', () => {
    test.describe.configure({ mode: 'serial' });
    let raceId: number;
    let racers: Racer[];

    test.beforeAll(async ({ request }) => {
        const seeded = await seedRace(request);
        raceId = seeded.raceId;
        racers = seeded.racers;
    });

    test('Standard Live view at 390×844: scrolls, legible, every lane visible, no Launch Projector Mode', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto(`/race/${raceId}/observation`);
        await page.waitForLoadState('networkidle');

        await expect(page.getByTestId('observation-standard-phone')).toBeVisible();
        await expect(page.locator('.standing-row').first()).toBeVisible();

        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollHeight: document.documentElement.scrollHeight,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(PHONE.width + 1);
        // This is the one tier allowed to scroll (`displays.md`) — a heat
        // card plus a real standings list does not fit 844px without it.
        expect(overflow.scrollHeight).toBeGreaterThan(PHONE.height);

        const nameSize = await fontSizeOf(page.locator('.standing-racer-name'));
        expect(nameSize).toBeGreaterThanOrEqual(14);

        // Every lane on the "Now Racing" card is visible — none clipped by
        // an `overflow: hidden` budget the way the vmin-sized tiers use.
        const laneCards = page.locator('.heat-card').first().locator('.heat-card-racer');
        const laneCount = await laneCards.count();
        expect(laneCount).toBeGreaterThan(0);
        for (let i = 0; i < laneCount; i++) {
            await expect(laneCards.nth(i)).toBeVisible();
        }

        await expect(page.getByRole('button', { name: /Launch Projector Mode/i })).toHaveCount(0);
    });

    test('Standard Live view at 1280×800: unchanged — Launch Projector Mode present, no scrolling', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/race/${raceId}/observation`);
        await page.waitForLoadState('networkidle');

        await expect(page.locator('.standing-row').first()).toBeVisible();
        await expect(page.getByTestId('observation-standard-phone')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Launch Projector Mode/i })).toBeVisible();

        const heights = await page.evaluate(() => ({
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
        }));
        expect(heights.scrollHeight).toBeLessThanOrEqual(heights.innerHeight + 1);
    });

    test('Check-in view at 390×844: one column, legible names', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto(`/race/${raceId}/observation?view=checkin`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('checkin-view')).toBeVisible();

        const groups = page.locator('[data-testid^="checkin-group-"]');
        const groupCount = await groups.count();
        expect(groupCount).toBeGreaterThanOrEqual(2);

        const boxes: Box[] = [];
        for (let i = 0; i < groupCount; i++) {
            const box = await groups.nth(i).boundingBox();
            expect(box).not.toBeNull();
            boxes.push(box as Box);
        }
        // One column: every den block starts at the same x.
        for (const box of boxes) {
            expect(Math.abs(box.x - boxes[0].x)).toBeLessThanOrEqual(1);
        }

        // A pending racer's own row — the leaf div carrying "#N " (a nested
        // span) plus the racer's name (a trailing text node) — reads at
        // least 12px, the issue's own floor.
        const rowFontSize = await page.evaluate(() => {
            const groupEls = document.querySelectorAll('[data-testid^="checkin-group-"]');
            for (const g of groupEls) {
                for (const row of g.querySelectorAll('div')) {
                    const text = row.textContent?.trim() ?? '';
                    if (/^#\d+\s/.test(text) && row.children.length <= 1) {
                        return parseFloat(getComputedStyle(row).fontSize);
                    }
                }
            }
            return null;
        });
        expect(rowFontSize).not.toBeNull();
        expect(rowFontSize as number).toBeGreaterThanOrEqual(12);
    });

    test('Check-in view at 1280×800: the auto-fit grid, unchanged', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/race/${raceId}/observation?view=checkin`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('checkin-view')).toBeVisible();

        const groups = page.locator('[data-testid^="checkin-group-"]');
        const boxes: Box[] = [];
        for (let i = 0; i < (await groups.count()); i++) {
            boxes.push((await groups.nth(i).boundingBox()) as Box);
        }
        // Two dens side by side at this width — not stacked in one column.
        expect(boxes.some((b) => Math.abs(b.x - boxes[0].x) > 1)).toBe(true);
    });

    test('Standings-only view at 390×844: readable header, badge clear of the Runs column', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto(`/race/${raceId}/observation?view=standings_only`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('standings-only-view')).toBeVisible();
        await expect(page.locator('.standing-row').first()).toBeVisible();

        const headerSize = await fontSizeOf(page.getByRole('columnheader', { name: 'Runs' }));
        expect(headerSize).toBeGreaterThanOrEqual(12);

        // Every fresh connection gets the connect badge briefly (#495) — wait
        // for it rather than racing its four-second fade.
        const badge = page.getByTestId('identify-connect-badge');
        await expect(badge).toBeVisible({ timeout: 10000 });

        const badgeBox = (await badge.boundingBox()) as Box;
        const runsBox = (await page.getByRole('columnheader', { name: 'Runs' }).boundingBox()) as Box;
        expect(badgeBox).not.toBeNull();
        expect(runsBox).not.toBeNull();
        expect(overlaps(badgeBox, runsBox)).toBe(false);
    });

    test('Standings-only view at 1280×800: the fixed-corner badge, unchanged', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/race/${raceId}/observation?view=standings_only`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('standings-only-view')).toBeVisible();

        const badge = page.getByTestId('identify-connect-badge');
        await expect(badge).toBeVisible({ timeout: 10000 });
        const style = await badge.evaluate((el) => getComputedStyle(el).position);
        expect(style).toBe('fixed');
    });

    test('Awards ceremony at 390×844: recipient clear of the footer, "1 of N" on one line, Fanfare visible, no Launch Projector Mode', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto(`/race/${raceId}/awards/present`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('ceremony-back-link')).toBeVisible();

        const winner = racers.find((r) => r.carNumber === Math.min(...racers.map((x) => x.carNumber)))!;
        const recipient = page.getByText(`${winner.firstName} ${winner.lastName} (#${winner.carNumber})`);
        await expect(recipient).toBeVisible();

        const footer = page.getByTestId('ceremony-sound-toggle');
        const recipientBox = (await recipient.boundingBox()) as Box;
        const footerBox = (await footer.boundingBox()) as Box;
        expect(recipientBox).not.toBeNull();
        expect(footerBox).not.toBeNull();
        expect(overlaps(recipientBox, footerBox)).toBe(false);

        // "1 of 2" on one line — no wrap onto "1 of" / "2".
        const position = page.getByText(/^\d+ of \d+$/);
        await expect(position).toBeVisible();
        const positionBox = (await position.boundingBox()) as Box;
        const lineHeight = await position.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * 1.6);
        expect(positionBox.height).toBeLessThanOrEqual(lineHeight);

        await expect(page.getByTestId('ceremony-sound-toggle')).toBeInViewport();
        await expect(page.getByRole('button', { name: /Launch Projector Mode/i })).toHaveCount(0);
    });

    test('Awards ceremony at 1280×800: unchanged', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/race/${raceId}/awards/present`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('ceremony-back-link')).toBeVisible();
        await expect(page.getByTestId('ceremony-sound-toggle')).toBeVisible();
        await expect(page.getByRole('button', { name: /Launch Projector Mode/i })).toHaveCount(0);
    });
});
