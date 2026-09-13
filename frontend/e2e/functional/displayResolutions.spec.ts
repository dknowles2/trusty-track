/**
 * Displays must render cleanly at low resolutions and read from the back of
 * the room (#1073, part 1 — the audit, the e2e gate, and every clean-render
 * fix, plus the legibility floor. Part 2 is density: which columns to drop,
 * row caps — deliberately not touched here).
 *
 * A pack's projector is rarely a modern monitor at arm's length: 1024×768
 * (XGA, the commonest old-projector native resolution), 1280×720 (a 720p TV
 * on a cart) and 800×600 (SVGA, the floor — the oldest projectors still in a
 * church basement) are all real venues. 1920×1080 is the control — the
 * resolution the screenshot specs were tuned at, which must keep working.
 *
 * One seeded race, one page, walked through every view `displayView.ts`
 * offers plus the break overlay, the results overlay and the "Race
 * complete!" screen — busiest case (24 racers, 6 lanes, several racing
 * groups, a partially-run schedule, an award) so the checks below are
 * exercised against real content rather than an empty state that would pass
 * trivially.
 *
 * Four checks, run at every viewport (except the results overlay — see its
 * own test for why that one is scoped to 800×600):
 *   1. No horizontal overflow — `document.documentElement.scrollWidth <=
 *      clientWidth`.
 *   2. No element clipped or silently overflowing where it should not be —
 *      swept generically across every element on the page, with one named
 *      exemption (see `STANDINGS_SCROLLER_SELECTOR` below).
 *   3. No two sibling cards/rows overlapping, per view.
 *   4. Every element whose *own* text is a racer's name, a car number, a
 *      place, or a time renders at a computed `font-size` of at least 2% of
 *      the viewport's height (the issue's own legibility floor — 12px at a
 *      600px-tall viewport, 15.36px at 768, 14.4px at 720). Found generically
 *      by matching rendered text against patterns built from the seeded
 *      roster, rather than a hand-maintained selector list per view — the
 *      same content a spectator actually reads, regardless of which class
 *      name happens to carry it this month.
 *
 * Exemptions from the legibility floor (#1073's own list — "annotations only
 * the operator needs"):
 *   - `.identify-connect-badge` — this screen's own whimsical name, shown
 *     briefly on connect/Identify (`IdentifyPresence.tsx`). Meant to be read
 *     by the operator holding the Displays panel, not the room.
 *   - `.timer-status-badge` — the hardware timer state pill
 *     (`TimerStatusBadge.tsx`, "Timer: Ready" and friends). Diagnostic
 *     information for whoever is running the track, not the audience.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from './support';

const VIEWPORTS = [
    { name: '800x600 (SVGA floor)', width: 800, height: 600 },
    { name: '1024x768 (XGA)', width: 1024, height: 768 },
    { name: '1280x720 (720p TV)', width: 1280, height: 720 },
    { name: '1920x1080 (control)', width: 1920, height: 1080 },
];

/**
 * The one legitimate case of "content taller than its container" —
 * `StandingsOnlyView`'s `SMOOTH` scroll behaviour moves a table taller than
 * the screen upward with a CSS transform on a fixed tick
 * (`standingsScroll.ts`), rather than a native scrollbar. Its inner content
 * is *supposed* to be taller than the outer, clipping container; that is the
 * whole mechanism, not a bug.
 */
const STANDINGS_SCROLLER_SELECTOR = '[data-testid="standings-only-view"]';

/** Elements exempt from the legibility floor — see this file's own header
 * comment for why each one is operator-only rather than audience-facing. */
const LEGIBILITY_EXEMPT_SELECTORS = ['.identify-connect-badge', '.timer-status-badge'];

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

/** A local, `APIRequestContext`-bound copy of `support.ts`'s `gql` — that
 * helper takes a `Page`, and most of this spec's own GraphQL calls (the
 * one-time seeding, recording a heat mid-test) have no page-scoped reason to
 * need one. */
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

/** Records a heat exactly the way `support.ts`'s `recordRound` does — car *n*
 * runs `3.0 + n/100`, so finishing order is car-number order and a test never
 * has to consult the leaderboard it is about to assert on. */
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

test.describe.configure({ mode: 'serial' });

test.describe('audience displays render cleanly at low resolutions (#1073, part 1)', () => {
    let raceId: number;
    let racers: Racer[];
    let pendingRacerNames: string[];
    let carNumberById: Map<number, number>;

    test.beforeAll(async ({ request }) => {
        // `ensureConfigured` needs a `Page` to drive the first-run form, but
        // `configure.setup.ts` has already cleared the gate for every spec in
        // this suite by the time this one runs — a bare `organizations` query
        // is enough to confirm that without pulling a page in just for it.
        const existing = await gql<{ organizations: { id: number }[] }>(
            request,
            `query { organizations { id } }`,
        );
        if (existing.organizations.length === 0) {
            throw new Error(
                'No organization configured — run the full suite (configure.setup.ts) rather than this spec alone.',
            );
        }

        const track = await gql<{ createTrack: { id: number } }>(
            request,
            `mutation($track: TrackInput!) { createTrack(track: $track) { id } }`,
            { track: { name: `Display Resolutions Track ${Date.now()}`, laneCount: 6, timerType: 'FAKE' } },
        );

        const race = await gql<{ createRace: { id: number } }>(
            request,
            `mutation($race: RaceInput!) { createRace(race: $race) { id } }`,
            {
                race: {
                    name: `Display Resolutions Race ${Date.now()}`,
                    organizationId: existing.organizations[0].id,
                    trackId: track.createTrack.id,
                    carNumberingStrategy: 'MANUAL',
                    scoringStrategy: 'TIMED',
                },
            },
        );
        raceId = race.createRace.id;

        const groups = ['Lion', 'Tiger', 'Wolf', 'Bear'];
        const groupIds: number[] = [];
        for (const name of groups) {
            const created = await gql<{ createRacingGroup: { id: number } }>(
                request,
                `mutation($raceId: Int!, $racingGroup: RacingGroupInput!) {
                    createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
                }`,
                { raceId, racingGroup: { name, color: '#2E86C1', division: name } },
            );
            groupIds.push(created.createRacingGroup.id);
        }

        // 24 racers, over four racing groups, real (if make-believe) names —
        // the busiest case the issue asks for, and names we can search
        // rendered text for directly rather than hand-maintaining a
        // per-component selector list.
        const FIRST_NAMES = [
            'Wren', 'Milo', 'Nadia', 'Otis', 'Priya', 'Quinn', 'Reid', 'Sana',
            'Toby', 'Uma', 'Viktor', 'Wanda', 'Xiomara', 'Yusuf', 'Zara', 'Abel',
            'Bibi', 'Cyrus', 'Dara', 'Enzo', 'Farrah', 'Gino', 'Hana', 'Ivo',
        ];
        const LAST_NAMES = [
            'Ashworth', 'Blackwood', 'Cortez', 'Delacroix', 'Ellery', 'Fenwick',
            'Grantham', 'Halloway', 'Iverson', 'Jacoby', 'Kestrel', 'Larkspur',
            'Marchetti', 'Norwood', 'Oaksley', 'Pemberton', 'Quintrell', 'Rosewood',
            'Sutcliffe', 'Thackeray', 'Underhill', 'Vandermeer', 'Whitfield', 'Yarborough',
        ];

        // A 1×1 transparent PNG, uploaded once through the same door the UI
        // does (`RacerInput.racerImageUrl` refuses anything but an
        // `uploadImage`-issued `/static/...` path) — the slideshow (and
        // every avatar on this page) needs *a* photo to have anything to
        // show.
        const uploaded = await gql<{ uploadImage: string }>(
            request,
            `mutation($dataUrl: String!) { uploadImage(dataUrl: $dataUrl) }`,
            {
                dataUrl:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            },
        );
        const PLACEHOLDER_PHOTO = uploaded.uploadImage;

        racers = [];
        for (let i = 0; i < 24; i++) {
            const created = await gql<{ createRacer: { id: number } }>(
                request,
                `mutation($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
                {
                    racer: {
                        raceId,
                        firstName: FIRST_NAMES[i],
                        lastName: LAST_NAMES[i],
                        carNumber: i + 1,
                        racingGroupId: groupIds[i % groupIds.length],
                        // Half the roster has a photo — enough for the
                        // slideshow (#175, "no photo, no slide") to have
                        // real content without every avatar on every other
                        // view being a photo (the initials-placeholder path
                        // through `RacerAvatar` is worth exercising too).
                        racerImageUrl: i % 2 === 0 ? PLACEHOLDER_PHOTO : null,
                    },
                },
            );
            racers.push({ id: created.createRacer.id, firstName: FIRST_NAMES[i], lastName: LAST_NAMES[i], carNumber: i + 1 });
        }
        carNumberById = new Map(racers.map((r) => [r.id, r.carNumber]));

        // All but the last three check in — the check-in view's own "still
        // pending" list, and its "N of 24 checked in" summary, get real
        // content rather than an all-or-nothing empty state.
        pendingRacerNames = racers.slice(-3).map((r) => `${r.firstName} ${r.lastName}`);
        for (const racer of racers.slice(0, -3)) {
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
            { raceId, config: { generalRound: { type: 'ALL', runsPerLane: 3 }, championshipRounds: [] } },
        );

        const heats = await readHeats(request, raceId);

        // Leave the last four heats unrecorded: three keep "Now Racing" / "On
        // Deck" / "After That" populated everywhere that reads them
        // (Projector, the standard Standings tab's own heat cards, the
        // Broadcast overlay's lower third); the fourth is spent later,
        // deliberately, by the results-overlay test.
        const toRecord = heats.slice(0, Math.max(0, heats.length - 4));
        for (const heat of toRecord) {
            await recordHeat(request, heat, carNumberById);
        }

        // A resolvable SPEED award (a winner falls out of the standings
        // already recorded above) and an unresolved SPECIAL one — the
        // ceremony's two shapes ("and the winner is…" and "Still to be
        // decided") both get exercised.
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
    });

    /** Every leaf element (no element children) whose own text is exactly a
     * racer's full name, or contains a car-number/place/time-shaped token —
     * generic across every view, so a legibility bug is caught wherever it
     * renders rather than only where a hand-picked selector happens to look. */
    async function legibilityFailures(page: Page, racerNames: readonly string[]): Promise<string[]> {
        return page.evaluate(
            ({ racerNames, exempt }) => {
                const nameSet = new Set(racerNames);
                const carNumberRe = /#\d{1,3}\b/;
                const placeRe = /^(1st|2nd|3rd|\d{1,2})$/;
                const timeRe = /^\d+\.\d{2,3}s?$/;
                const floor = window.innerHeight * 0.02;
                const bad: string[] = [];

                document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
                    if (el.children.length > 0) return; // not a leaf
                    if (exempt.some((sel: string) => el.closest(sel))) return;
                    const text = (el.textContent ?? '').trim();
                    if (!text) return;
                    const isName = nameSet.has(text);
                    const isCarNumber = carNumberRe.test(text);
                    const isPlace = placeRe.test(text);
                    const isTime = timeRe.test(text);
                    if (!isName && !isCarNumber && !isPlace && !isTime) return;

                    const size = parseFloat(getComputedStyle(el).fontSize);
                    if (size < floor - 0.5) {
                        bad.push(
                            `"${text}" (${el.tagName}.${String(el.className).replace(/\s+/g, '.')}) is ${size.toFixed(1)}px, below the ${floor.toFixed(1)}px floor (2% of ${window.innerHeight}px viewport height)`,
                        );
                    }
                });
                return bad;
            },
            { racerNames, exempt: LEGIBILITY_EXEMPT_SELECTORS },
        );
    }

    async function verticalOverflowFailures(page: Page): Promise<string[]> {
        return page.evaluate(({ exemptSelector }) => {
            const bad: string[] = [];
            document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
                if (el.closest(exemptSelector)) return;
                if (el.scrollHeight <= el.clientHeight + 1) return;
                if (el.clientHeight === 0) return;
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;
                // `scrollHeight` exceeding `clientHeight` only means content
                // is actually being *clipped* when this element's own
                // overflow is restrictive (`hidden`/`auto`/`scroll`/`clip`).
                // With the default `visible`, nothing is cropped — the two
                // numbers can still disagree for a flex/table box holding
                // nothing but a short text run (a rounding artifact of how a
                // browser computes a flex item's content height for bare
                // text versus the line box `scrollHeight` reports), and that
                // mismatch is invisible on screen because there is no clip
                // region to fall outside of.
                if (!/(hidden|auto|scroll|clip)/.test(style.overflowY) && !/(hidden|auto|scroll|clip)/.test(style.overflowX)) return;
                bad.push(
                    `${el.tagName}.${String(el.className).replace(/\s+/g, '.')} clips its content: scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`,
                );
            });
            return bad;
        }, { exemptSelector: STANDINGS_SCROLLER_SELECTOR });
    }

    async function overlapFailures(page: Page, selector: string): Promise<string[]> {
        const boxes = await page.locator(selector).evaluateAll((els) =>
            els.map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            }),
        );
        const bad: string[] = [];
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const b = boxes[j];
                const overlaps =
                    a.x < b.x + b.width - 1 && a.x + a.width - 1 > b.x && a.y < b.y + b.height - 1 && a.y + a.height - 1 > b.y;
                if (overlaps) {
                    bad.push(`${selector}[${i}] overlaps ${selector}[${j}]: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
                }
            }
        }
        return bad;
    }

    /** The four checks this file's own header comment describes, run against
     * whatever `page` is currently showing. `fullScreen` views additionally
     * must not need the page itself to scroll — they lock body overflow
     * (`Observation.tsx`'s `isFullScreenView`), so anything too tall for the
     * viewport there is clipped rather than reachable, not merely scrolled. */
    async function assertCleanRender(
        page: Page,
        opts: { fullScreen: boolean; overlapSelectors?: readonly string[]; racerNames?: readonly string[] },
    ): Promise<void> {
        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        expect(
            overflow.scrollWidth,
            `horizontal overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);

        if (opts.fullScreen) {
            const heights = await page.evaluate(() => ({
                scrollHeight: document.documentElement.scrollHeight,
                innerHeight: window.innerHeight,
            }));
            expect(
                heights.scrollHeight,
                `full-screen view needs to scroll: document height=${heights.scrollHeight} > viewport height=${heights.innerHeight}`,
            ).toBeLessThanOrEqual(heights.innerHeight + 1);
        }

        const clipped = await verticalOverflowFailures(page);
        expect(clipped, clipped.join('\n')).toEqual([]);

        for (const selector of opts.overlapSelectors ?? []) {
            const overlaps = await overlapFailures(page, selector);
            expect(overlaps, overlaps.join('\n')).toEqual([]);
        }

        const tooSmall = await legibilityFailures(page, opts.racerNames ?? racerNames());
        expect(tooSmall, tooSmall.join('\n')).toEqual([]);
    }

    function racerNames(): string[] {
        return racers.map((r) => `${r.firstName} ${r.lastName}`);
    }

    async function forEachViewport(page: Page, run: (vp: (typeof VIEWPORTS)[number]) => Promise<void>): Promise<void> {
        for (const vp of VIEWPORTS) {
            await page.setViewportSize(vp);
            await run(vp);
        }
    }

    test('Standings (the standard Live view)', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.standings-table')).toBeVisible();
            await assertCleanRender(page, { fullScreen: false, overlapSelectors: ['.heat-card', '.standing-row'] });
        });
    });

    test("Last heat's times", async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=timing`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.timing-list-item').first()).toBeVisible();
            await assertCleanRender(page, { fullScreen: false, overlapSelectors: ['.timing-list-item'] });
        });
    });

    test('Cycle between both (the same standard-mode markup, alternating)', async ({ page }) => {
        // No JSX of its own — `behaviourFor('CYCLE', …)` only flips
        // `activeTab` on a timer, so what is on screen at any instant is
        // exactly the Standings or Timing render already checked above.
        // This confirms the URL shape itself (`?cycle=true`) resolves to
        // that same clean markup rather than something unique to it.
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?cycle=true`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.standings-table')).toBeVisible();
            await assertCleanRender(page, { fullScreen: false, overlapSelectors: ['.heat-card', '.standing-row'] });
        });
    });

    test('Projector', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?projector=true`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.projector-grid')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, overlapSelectors: ['.projector-racer-card'] });
        });
    });

    test('Racer photos (the slideshow)', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=slideshow`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('slideshow')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true });
        });
    });

    test('Standings only', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=standings_only`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('standings-only-view')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, overlapSelectors: ['.standing-row'] });
        });
    });

    test('Check-in progress', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=checkin`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('checkin-view')).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: true,
                overlapSelectors: ['[data-testid^="checkin-group-"]'],
                racerNames: pendingRacerNames,
            });
        });
    });

    test('QR code', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=qrcode`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('qrcode-view')).toBeVisible();
            // No racer name/car number/place/time on this view at all — the
            // legibility floor has nothing to check here, so an empty list
            // is passed explicitly rather than the seeded roster's names.
            await assertCleanRender(page, { fullScreen: true, racerNames: [] });
        });
    });

    test('Broadcast overlay (OBS)', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation?view=overlay`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('overlay-view')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true });
        });
    });

    test('Awards ceremony', async ({ page }) => {
        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/awards/present`);
            await page.waitForLoadState('networkidle');
            // Either slide is fine — the resolved SPEED award's winner, or
            // the unresolved SPECIAL one's "Still to be decided" — both are
            // exercised across the two awards seeded above, and which one the
            // operator's own step lands on first is not this test's concern;
            // waiting on the back link is enough to know a slide has rendered.
            await expect(page.getByTestId('ceremony-back-link')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true });
        });
    });

    test('Break overlay', async ({ page, request }) => {
        await gql(
            request,
            `mutation($raceId: Int!, $duration: Int!, $label: String) {
                startIntermission(raceId: $raceId, durationSeconds: $duration, label: $label) { id }
            }`,
            { raceId, duration: 600, label: 'Break time' },
        );

        try {
            await forEachViewport(page, async () => {
                await page.goto(`/race/${raceId}/observation`);
                await page.waitForLoadState('networkidle');
                await expect(page.getByTestId('intermission-overlay')).toBeVisible();
                await assertCleanRender(page, { fullScreen: true });
            });
        } finally {
            // The "Race complete!" test below needs no break in the way.
            await gql(request, `mutation($raceId: Int!) { endIntermission(raceId: $raceId) { id } }`, { raceId });
        }
    });

    test('Results overlay (800×600 only — see this test\'s own comment)', async ({ page, request }) => {
        // Unlike every view above, this is not a stable render: it appears
        // for five seconds (ten on the Broadcast overlay) once a *new* heat
        // result lands while the page is open (`observeHeatResult`'s
        // `seen === null` rule), then disappears on its own. Sweeping it
        // across all four viewports would need a freshly-unrecorded heat per
        // viewport; the issue itself calls out only one — "the results
        // overlay must fit without cropping at 800×600" — so that is the one
        // this spends the schedule's fourth deliberately-held-back heat on.
        await page.setViewportSize(VIEWPORTS[0]);
        await page.goto(`/race/${raceId}/observation?projector=true`);
        await page.waitForLoadState('networkidle');
        // Let the opening snapshot land and be marked "seen" before the
        // fresh result is recorded — otherwise the two race and the overlay
        // may never open at all.
        await page.waitForTimeout(500);

        const unrecorded = (await readHeats(request, raceId)).filter((h) => h.recordedAt === null);
        expect(unrecorded.length, 'expected one heat deliberately held back for this test').toBeGreaterThan(0);
        await recordHeat(request, unrecorded[0], carNumberById);

        await expect(page.locator('.results-overlay')).toBeVisible({ timeout: 10000 });
        await assertCleanRender(page, { fullScreen: true, overlapSelectors: ['.overlay-result-item'] });
    });

    test('Race complete!', async ({ page, request }) => {
        const unrecorded = (await readHeats(request, raceId)).filter((h) => h.recordedAt === null);
        for (const heat of unrecorded) {
            await recordHeat(request, heat, carNumberById);
        }

        await forEachViewport(page, async () => {
            await page.goto(`/race/${raceId}/observation`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('race-finished-overlay')).toBeVisible({ timeout: 10000 });
            await assertCleanRender(page, { fullScreen: true });
        });
    });
});
