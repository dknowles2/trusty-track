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
 * A second, 8-lane/32-racer race (`seedRace`, parametrized rather than a
 * second copy of the setup) exists for exactly one test — "Standings (8-lane
 * track)" below — because an 8-lane track is `Track.lane_count`'s own
 * ceiling and review found that `displayDensity.ts`'s viewport budget, tuned
 * and gated only against the 6-lane seed, broke the Standings tab's own
 * guaranteed row count at 1280×720 once a track actually used it (#1073's
 * own follow-up review, `displayDensity.ts`'s "Lane count is an input
 * alongside width and height" section). Every other view in this file stays
 * on the 6-lane seed — the density budget's lane-count tiering only touches
 * the heat cards and the Standings tab it sits above, so there is nothing
 * for a second seed to add anywhere else.
 *
 * Four checks, run at every viewport (except the results overlay — see its
 * own test for why that one is scoped to 800×600):
 *   1. No horizontal overflow — `document.documentElement.scrollWidth <=
 *      clientWidth`.
 *   2. No element clips a descendant — swept generically across every
 *      element on the page, with one named exemption (see
 *      `STANDINGS_SCROLLER_SELECTOR` below). Decided by geometry, not by
 *      `scrollHeight` vs `clientHeight`: those two numbers only flag a
 *      *candidate*, confirmed only when some descendant's own rendered box
 *      actually falls outside the element's border box (`getBoundingClientRect`; no measured wrapper carries a bottom or right border, so the two coincide) by more than 1px
 *      (`verticalOverflowFailures`). A `scrollHeight` a pixel or two past
 *      `clientHeight` with every child still fully inside is sub-pixel
 *      accumulation of table-row line boxes, not a clip — see that
 *      function's own comment and [#1273](https://github.com/dknowles2/trusty-track/issues/1273)
 *      for the CI run this was found on (a Standings wrapper measured
 *      scrollHeight=404/clientHeight=402, failed 3/3 on one runner, then
 *      passed 109/109 on a re-run of the identical commit).
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

/**
 * "Clips its content" is decided by geometry, not by `scrollHeight`
 * exceeding `clientHeight` — that comparison is only a cheap candidate
 * filter, kept so the (more expensive) geometry walk below only runs on
 * elements it flags. `scrollHeight` is the height of an element's own *line
 * boxes*, and a browser can round those independently of the *rendered*
 * position of the child that produced them, so the two scalars can disagree
 * by a pixel or two with every child still fully inside the box — invisible
 * on screen, because nothing is actually being cropped. That is exactly
 * what happened on CI for [#1273](https://github.com/dknowles2/trusty-track/issues/1273):
 * a `.standings-table-wrapper` holding nothing but table rows of bare text
 * measured `scrollHeight=404 clientHeight=402` — one pixel past the old
 * tolerance — failed 3/3 on one runner (the initial attempt and both
 * Playwright retries, same two numbers each time), then passed 109/109 on a
 * re-run of the byte-identical commit on a different runner. The confirming
 * question this function actually asks is "does any descendant's own
 * rendered box fall outside this element's border box" — the literal
 * meaning of "clips its content" — via `getBoundingClientRect()` on the
 * element and every descendant, comparing the child's `bottom`/`right`
 * against the parent's own, rather than trusting `scrollHeight` to answer
 * that on its own.
 *
 * [#1333](https://github.com/dknowles2/trusty-track/issues/1333) is the
 * same failure one layer down: the geometry walk above still failed, by
 * 1.6px against the 1px tolerance it added, on the identical
 * `.standings-table-wrapper`. The offending descendant named in that
 * message was `TABLE.standings-table` — the wrapper's *direct child*, not
 * a `<tr>` or any text-bearing leaf. That is the tell: a `<table>` under
 * `border-collapse: collapse` gets its own generated border box from the
 * table-layout algorithm's rounding of the collapsed border between its
 * last row and its own edge, a value with no relationship to whether that
 * row's own text is visible — reproduced deterministically with a
 * `border-bottom` on a `<table>` decoupling its box from its `<tr>`'s by a
 * clean, font-independent 1.5px (see this PR's own description for the
 * probe). Walking "every descendant" therefore asks the wrong question for
 * a container element: `<table>`, `<tbody>` and `<tr>` are never
 * themselves rendered content, only arrangements of the elements inside
 * them, so their own boxes can disagree with their children's by a
 * layout-engine rounding artifact that a reader never sees. Two changes
 * fix that:
 *
 *   1. Only *leaf* descendants (no child elements — text, an image, a
 *      childless badge) are candidates. A leaf's own box is the thing a
 *      person actually reads; a container's is a computed aggregate.
 *   2. Because real (font-rendered) rows still accumulate a little
 *      sub-pixel rounding of their own — the flat `1` a leaf's overshoot
 *      was compared to before doesn't scale with how tall a line of text
 *      is — each leaf's own tolerance on the vertical axis is a quarter of
 *      its *own* computed `line-height` (falling back to `1.2 ×
 *      font-size` when the cascade never set one, i.e. `line-height:
 *      normal`), floored at 1px so a zero/near-zero line-height leaf keeps
 *      the original tolerance. A quarter of a line is comfortably under
 *      where a reader would notice a missing glyph, and it is keyed to the
 *      one leaf actually being judged, so it cannot smuggle a bigger
 *      allowance in under an unrelated ancestor's font size. The
 *      horizontal axis keeps the flat 1px tolerance — a "how many
 *      characters wide" analogue would be a different, unmeasured
 *      quantity, and neither #1273 nor #1333 was a horizontal case.
 *
 * Each leaf is judged against its *own* tolerance (tracked as the largest
 * `overshoot - tolerance`, not the largest raw overshoot), because a small
 * leaf with a small allowance can be genuinely clipped by less than a
 * bigger leaf elsewhere is merely rounding by.
 *
 * Module-level (not nested in the main `test.describe` below) so the
 * synthetic cases at the bottom of this file — a fresh `page.setContent`
 * page, not the seeded race — can call the exact function under test
 * rather than a hand-copied stand-in that could quietly drift from it.
 */
async function verticalOverflowFailures(page: Page, viewportLabel?: string): Promise<string[]> {
    return page.evaluate(({ exemptSelector, viewportLabel }) => {
        const bad: string[] = [];
        document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
            if (el.closest(exemptSelector)) return;
            if (el.scrollHeight <= el.clientHeight + 1) return;
            if (el.clientHeight === 0) return;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            // `scrollHeight` exceeding `clientHeight` only means content is
            // a *candidate* for being clipped when this element's own
            // overflow is restrictive (`hidden`/`auto`/`scroll`/`clip`).
            // With the default `visible`, nothing is cropped regardless of
            // what the geometry walk below would find.
            const restrictiveY = /(hidden|auto|scroll|clip)/.test(style.overflowY);
            const restrictiveX = /(hidden|auto|scroll|clip)/.test(style.overflowX);
            if (!restrictiveY && !restrictiveX) return;

            // Confirm the candidate by geometry: walk every *leaf*
            // descendant (no child elements of its own — see this
            // function's own comment on why a container like `<table>` is
            // excluded) and find the one poking outside this element's own
            // box by the most relative to its own tolerance, on whichever
            // axis is restrictive here. Skips `display: none` and
            // zero-size descendants — neither occupies any rendered box to
            // fall outside of anything.
            const box = el.getBoundingClientRect();
            let worstExcess = -Infinity;
            let worstDescriptor = '';
            el.querySelectorAll<HTMLElement>('*').forEach((child) => {
                if (child.children.length > 0) return;
                const childStyle = getComputedStyle(child);
                if (childStyle.display === 'none') return;
                const childBox = child.getBoundingClientRect();
                if (childBox.width === 0 && childBox.height === 0) return;
                const childLabel = `${child.tagName}.${String(child.className).replace(/\s+/g, '.')}`;

                if (restrictiveY) {
                    const lineHeightPx = parseFloat(childStyle.lineHeight);
                    const fontSizePx = parseFloat(childStyle.fontSize);
                    const naturalLineHeight = Number.isFinite(lineHeightPx)
                        ? lineHeightPx
                        : Number.isFinite(fontSizePx)
                          ? fontSizePx * 1.2
                          : 0;
                    const tolerance = Math.max(1, naturalLineHeight * 0.25);
                    const overshoot = childBox.bottom - box.bottom;
                    const excess = overshoot - tolerance;
                    if (excess > worstExcess) {
                        worstExcess = excess;
                        worstDescriptor = `${childLabel} overshoots the bottom edge by ${overshoot.toFixed(1)}px (tolerance ${tolerance.toFixed(1)}px)`;
                    }
                }
                if (restrictiveX) {
                    // No line-height analogue on this axis — see this
                    // function's own comment.
                    const tolerance = 1;
                    const overshoot = childBox.right - box.right;
                    const excess = overshoot - tolerance;
                    if (excess > worstExcess) {
                        worstExcess = excess;
                        worstDescriptor = `${childLabel} overshoots the right edge by ${overshoot.toFixed(1)}px (tolerance ${tolerance.toFixed(1)}px)`;
                    }
                }
            });
            if (worstExcess <= 0) return;

            bad.push(
                `${viewportLabel ? `[${viewportLabel}] ` : ''}${el.tagName}.${String(el.className).replace(/\s+/g, '.')} clips its content: scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight} — ${worstDescriptor}`,
            );
        });
        return bad;
    }, { exemptSelector: STANDINGS_SCROLLER_SELECTOR, viewportLabel });
}

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

// 32 racers' worth of real (if make-believe) names — the 6-lane seed below
// uses the first 24, the 8-lane one (`seedRace`'s own review-follow-up case)
// uses all 32 — searched for directly in rendered text rather than
// hand-maintaining a per-component selector list.
const FIRST_NAMES = [
    'Wren', 'Milo', 'Nadia', 'Otis', 'Priya', 'Quinn', 'Reid', 'Sana',
    'Toby', 'Uma', 'Viktor', 'Wanda', 'Xiomara', 'Yusuf', 'Zara', 'Abel',
    'Bibi', 'Cyrus', 'Dara', 'Enzo', 'Farrah', 'Gino', 'Hana', 'Ivo',
    'Jael', 'Kato', 'Lior', 'Maren', 'Neo', 'Opal', 'Pilar', 'Quill',
];
const LAST_NAMES = [
    'Ashworth', 'Blackwood', 'Cortez', 'Delacroix', 'Ellery', 'Fenwick',
    'Grantham', 'Halloway', 'Iverson', 'Jacoby', 'Kestrel', 'Larkspur',
    'Marchetti', 'Norwood', 'Oaksley', 'Pemberton', 'Quintrell', 'Rosewood',
    'Sutcliffe', 'Thackeray', 'Underhill', 'Vandermeer', 'Whitfield', 'Yarborough',
    'Zamora', 'Ainsworth', 'Bramblewood', 'Castellane', 'Dunmore', 'Everhart',
    'Fairweather', 'Gladstone',
];

interface SeededRace {
    raceId: number;
    racers: Racer[];
    carNumberById: Map<number, number>;
    pendingRacerNames: string[];
}

/**
 * Builds one race with its own track, so a track's own `laneCount` — the
 * thing under test in the 8-lane case below — is never shared between the
 * two seeds. Parametrized (`laneCount`, `racerCount`) rather than copied,
 * so the two seeds cannot quietly drift apart on everything *but* the one
 * property the second one exists to vary.
 */
async function seedRace(
    request: APIRequestContext,
    organizationId: number,
    opts: { laneCount: number; racerCount: number; unrecordedTailCount: number; label: string },
): Promise<SeededRace> {
    const track = await gql<{ createTrack: { id: number } }>(
        request,
        `mutation($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: `Display Resolutions Track (${opts.label}) ${Date.now()}`, laneCount: opts.laneCount, timerType: 'FAKE' } },
    );

    const race = await gql<{ createRace: { id: number } }>(
        request,
        `mutation($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: `Display Resolutions Race (${opts.label}) ${Date.now()}`,
                organizationId,
                trackId: track.createTrack.id,
                carNumberingStrategy: 'MANUAL',
                scoringStrategy: 'TIMED',
            },
        },
    );
    const raceId = race.createRace.id;

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

    // A 1×1 transparent PNG, uploaded once through the same door the UI
    // does (`RacerInput.racerImageUrl` refuses anything but an
    // `uploadImage`-issued `/static/...` path) — the slideshow (and every
    // avatar on this page) needs *a* photo to have anything to show.
    const uploaded = await gql<{ uploadImage: string }>(
        request,
        `mutation($dataUrl: String!) { uploadImage(dataUrl: $dataUrl) }`,
        {
            dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
    );
    const PLACEHOLDER_PHOTO = uploaded.uploadImage;

    const racers: Racer[] = [];
    for (let i = 0; i < opts.racerCount; i++) {
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
                    // slideshow (#175, "no photo, no slide") to have real
                    // content without every avatar on every other view
                    // being a photo (the initials-placeholder path through
                    // `RacerAvatar` is worth exercising too).
                    racerImageUrl: i % 2 === 0 ? PLACEHOLDER_PHOTO : null,
                },
            },
        );
        racers.push({ id: created.createRacer.id, firstName: FIRST_NAMES[i], lastName: LAST_NAMES[i], carNumber: i + 1 });
    }
    const carNumberById = new Map(racers.map((r) => [r.id, r.carNumber]));

    // All but the last three check in — the check-in view's own "still
    // pending" list, and its "N of <racerCount> checked in" summary, get
    // real content rather than an all-or-nothing empty state.
    const pendingRacerNames = racers.slice(-3).map((r) => `${r.firstName} ${r.lastName}`);
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

    // Leave the tail unrecorded so "Now Racing" / "On Deck" / "After That"
    // stay populated everywhere that reads them (Projector, the standard
    // Standings tab's own heat cards, the Broadcast overlay's lower third).
    const toRecord = heats.slice(0, Math.max(0, heats.length - opts.unrecordedTailCount));
    for (const heat of toRecord) {
        await recordHeat(request, heat, carNumberById);
    }

    return { raceId, racers, carNumberById, pendingRacerNames };
}

test.describe.configure({ mode: 'serial' });

test.describe('audience displays render cleanly at low resolutions (#1073, part 1)', () => {
    let raceId: number;
    let racers: Racer[];
    let pendingRacerNames: string[];
    let carNumberById: Map<number, number>;

    // The 8-lane/32-racer case (#1073's own follow-up review) — used by
    // exactly one test, "Standings (8-lane track)" below. See this file's
    // own header comment for why it needs a second seed rather than a
    // parametrized version of every test here.
    let raceId8: number;
    let racers8: Racer[];

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
        const organizationId = existing.organizations[0].id;

        const primary = await seedRace(request, organizationId, {
            laneCount: 6,
            racerCount: 24,
            // Three keep the heat cards populated; the fourth is spent
            // later, deliberately, by the results-overlay test.
            unrecordedTailCount: 4,
            label: '6-lane',
        });
        raceId = primary.raceId;
        racers = primary.racers;
        carNumberById = primary.carNumberById;
        pendingRacerNames = primary.pendingRacerNames;

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

        const eightLane = await seedRace(request, organizationId, {
            laneCount: 8,
            racerCount: 32,
            unrecordedTailCount: 3,
            label: '8-lane',
        });
        raceId8 = eightLane.raceId;
        racers8 = eightLane.racers;
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
        opts: {
            fullScreen: boolean;
            viewport: string;
            overlapSelectors?: readonly string[];
            racerNames?: readonly string[];
        },
    ): Promise<void> {
        // Wait for the bundled webfonts to finish their `font-display: swap`
        // swap before measuring anything below — found chasing #1273 itself.
        // The geometric confirmation in `verticalOverflowFailures` is
        // correct as far as it goes, but reproducing the flake locally (see
        // the PR this landed in) turned up a *second*, genuine cause behind
        // the same 404/402 numbers: while the Standings table is still
        // showing its fallback system font, its rows measure taller than
        // they do once the real font swaps in, which can push the table's
        // own rendered box a couple of pixels past the wrapper's clip box —
        // a real, if momentary and self-correcting, overshoot the new check
        // is right to catch in that instant. `documentation.md`'s "The font
        // wait closed the one gap that made the *machine* matter" already
        // diagnosed this exact class of bug for the doc screenshots (#821);
        // this spec measures layout instead of pixels, but the underlying
        // race — a browser that has never fetched this font before losing
        // the swap on a cold run — is the same one, and `document.fonts.ready`
        // is the same fix. Reproduced 2 failures in 6 full-file local runs
        // without this wait and 0 in 6 with it.
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        expect(
            overflow.scrollWidth,
            `at ${opts.viewport}: horizontal overflow: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);

        if (opts.fullScreen) {
            const heights = await page.evaluate(() => ({
                scrollHeight: document.documentElement.scrollHeight,
                innerHeight: window.innerHeight,
            }));
            expect(
                heights.scrollHeight,
                `at ${opts.viewport}: full-screen view needs to scroll: document height=${heights.scrollHeight} > viewport height=${heights.innerHeight}`,
            ).toBeLessThanOrEqual(heights.innerHeight + 1);
        }

        const clipped = await verticalOverflowFailures(page, opts.viewport);
        expect(clipped, clipped.join('\n')).toEqual([]);

        for (const selector of opts.overlapSelectors ?? []) {
            const overlaps = await overlapFailures(page, selector);
            expect(overlaps, `at ${opts.viewport}:\n${overlaps.join('\n')}`).toEqual([]);
        }

        const tooSmall = await legibilityFailures(page, opts.racerNames ?? racerNames());
        expect(tooSmall, `at ${opts.viewport}:\n${tooSmall.join('\n')}`).toEqual([]);
    }

    function racerNames(): string[] {
        return racers.map((r) => `${r.firstName} ${r.lastName}`);
    }

    /** The Standings tab's own guaranteed minimum — `displayDensity.ts`'s
     * viewport budget (the heat cards row's own ceiling, and the on-deck
     * depth that keeps enough lanes' worth of cards under it) exists
     * specifically so this always holds, even at the SVGA floor with this
     * file's own busiest 6-lane seed. */
    const MIN_GUARANTEED_STANDINGS_ROWS = 5;

    /**
     * The standard mode's own Standings tab used to have no row cap at all —
     * `standings-table-wrapper` grew to fit every racer, and the *page*
     * scrolled past the fold to show the rest, which nobody at the back of
     * the room was ever going to do (#1073 part 2). This checks the actual
     * fix rather than trusting the mechanism: at least
     * `MIN_GUARANTEED_STANDINGS_ROWS` rows, every one of them fully inside
     * the viewport (no row below the fold, and none clipped by the
     * wrapper's own `overflow: hidden`); fewer than the full 24-racer
     * roster (proof it is paging rather than dumping everyone on screen);
     * and — since the seed is deliberately busier than any of these four
     * viewports can show at once — a page indicator naming more than one
     * page.
     */
    async function standingsTabPagingFailures(
        page: Page,
        viewportHeight: number,
        totalRacerCount: number = racers.length,
    ): Promise<string[]> {
        const bad: string[] = [];
        const rows = page.locator('.standing-row');
        const rowCount = await rows.count();
        if (rowCount === 0) {
            bad.push('no .standing-row rendered at all');
            return bad;
        }
        if (rowCount < MIN_GUARANTEED_STANDINGS_ROWS) {
            bad.push(`only ${rowCount} of a guaranteed minimum ${MIN_GUARANTEED_STANDINGS_ROWS} standings rows rendered`);
        }
        if (rowCount >= totalRacerCount) {
            bad.push(`rendered every racer (${rowCount} of ${totalRacerCount}) rather than paging`);
        }
        for (let i = 0; i < rowCount; i++) {
            const box = await rows.nth(i).boundingBox();
            if (!box) {
                bad.push(`row ${i} has no bounding box`);
                continue;
            }
            if (box.y < -1) {
                bad.push(`row ${i} starts above the viewport (y=${box.y})`);
            }
            if (box.y + box.height > viewportHeight + 1) {
                bad.push(
                    `row ${i} extends below the fold: bottom=${(box.y + box.height).toFixed(1)} > viewport height ${viewportHeight}`,
                );
            }
        }

        const indicator = page.getByTestId('standings-tab-page-indicator');
        if ((await indicator.count()) === 0) {
            bad.push('no standings-tab-page-indicator rendered, even though the roster should overflow one page');
            return bad;
        }
        const text = await indicator.textContent();
        const match = text?.match(/Page \d+ of (\d+)/);
        if (!match) {
            bad.push(`page indicator text did not match "Page N of M": "${text}"`);
        } else if (Number(match[1]) <= 1) {
            bad.push(`page indicator reports only ${match[1]} page(s) for a 24-racer roster`);
        }
        return bad;
    }

    /**
     * The three secondary-text elements `displayDensity.ts` drops below its
     * 1024px width threshold (#1073 part 2) — present at and above it,
     * absent below it. Which of the three are on screen at all depends on
     * the view (`.standing-racing-group-division` is the Standings tab's
     * own table; the Timing tab renders no such table), so each call site
     * names only the ones its own view actually renders.
     */
    async function secondaryTextFailures(
        page: Page,
        vp: (typeof VIEWPORTS)[number],
        selectors: readonly string[],
    ): Promise<string[]> {
        const bad: string[] = [];
        for (const selector of selectors) {
            const count = await page.locator(selector).count();
            const showsAt1024 = vp.width >= 1024;
            if (showsAt1024 && count === 0) {
                bad.push(`${selector}: expected at least one at ${vp.name} (>= 1024px wide), found none`);
            }
            if (!showsAt1024 && count > 0) {
                bad.push(`${selector}: expected none below 1024px wide at ${vp.name}, found ${count}`);
            }
        }
        return bad;
    }

    async function forEachViewport(page: Page, run: (vp: (typeof VIEWPORTS)[number]) => Promise<void>): Promise<void> {
        for (const vp of VIEWPORTS) {
            await page.setViewportSize(vp);
            await run(vp);
        }
    }

    test('Standings (the standard Live view)', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.standings-table')).toBeVisible();
            // `networkidle` only tracks HTTP traffic, not the leaderboard
            // subscription's own WebSocket payload — the table itself can be
            // visible (an empty `<tbody>`) before the first snapshot has
            // arrived, which is what made this flake in CI under load
            // (#1155). Wait on the content the assertions below actually
            // count, the same way "Last heat's times" already waits on
            // `.timing-list-item` rather than its own table wrapper.
            await expect(page.locator('.standing-row').first()).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: false,
                viewport: vp.name,
                overlapSelectors: ['.heat-card', '.standing-row'],
            });

            // Every row on screen fits the fold, and the roster (24 racers,
            // busier than any of these four viewports can show at once)
            // pages rather than growing the page underneath it (#1073 part
            // 2).
            const pagingFailures = await standingsTabPagingFailures(page, vp.height);
            expect(pagingFailures, `at ${vp.name}:\n${pagingFailures.join('\n')}`).toEqual([]);

            // The racing-group division under a name, and (on the heat
            // cards above the table) under a staged racer, drop below the
            // 1024px width threshold.
            const densityFailures = await secondaryTextFailures(page, vp, [
                '.standing-racing-group-division',
                '.heat-card-racing-group-division',
            ]);
            expect(densityFailures, `at ${vp.name}:\n${densityFailures.join('\n')}`).toEqual([]);
        });
    });

    /**
     * The 8-lane/32-racer case #1073's own follow-up review added
     * (`Track.lane_count`'s own ceiling): `displayDensity.ts`'s viewport
     * budget was tuned and gated only against the 6-lane seed above, and an
     * 8-lane track broke the Standings tab's own guaranteed row count at
     * 1280×720 — three cards at `heatCardCompactness`'s old top tier (shared
     * with 6 lanes) cost enough of `heatCardsMaxHeightVh` to starve the
     * table. Runs the identical checks as "Standings" above, against the
     * 8-lane race instead — the same four clean-render checks plus the
     * ≥5-rows guarantee — at all four viewports, including the one that
     * failed in review.
     */
    test("Standings (8-lane track, Track.lane_count's own ceiling — #1073 review)", async ({ page }) => {
        const racerNames8 = racers8.map((r) => `${r.firstName} ${r.lastName}`);
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId8}/observation`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.standings-table')).toBeVisible();
            // See the 6-lane "Standings" test above (#1155) — this is the
            // case that actually flaked in CI, on the busier 32-racer seed.
            await expect(page.locator('.standing-row').first()).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: false,
                viewport: vp.name,
                overlapSelectors: ['.heat-card', '.standing-row'],
                racerNames: racerNames8,
            });

            const pagingFailures = await standingsTabPagingFailures(page, vp.height, racers8.length);
            expect(pagingFailures, `at ${vp.name}:\n${pagingFailures.join('\n')}`).toEqual([]);

            const densityFailures = await secondaryTextFailures(page, vp, [
                '.standing-racing-group-division',
                '.heat-card-racing-group-division',
            ]);
            expect(densityFailures, `at ${vp.name}:\n${densityFailures.join('\n')}`).toEqual([]);
        });
    });

    test("Last heat's times", async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=timing`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.timing-list-item').first()).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: false,
                viewport: vp.name,
                overlapSelectors: ['.timing-list-item'],
            });

            // The car's own name under a racer's name on this tab, and (on
            // the heat cards above it) the racing-group division under a
            // staged racer, are the other two secondary lines
            // `displayDensity.ts` drops (#1073 part 2).
            const densityFailures = await secondaryTextFailures(page, vp, [
                '.timing-car-name',
                '.heat-card-racing-group-division',
            ]);
            expect(densityFailures, `at ${vp.name}:\n${densityFailures.join('\n')}`).toEqual([]);
        });
    });

    test('Cycle between both (the same standard-mode markup, alternating)', async ({ page }) => {
        // No JSX of its own — `behaviourFor('CYCLE', …)` only flips
        // `activeTab` on a timer, so what is on screen at any instant is
        // exactly the Standings or Timing render already checked above.
        // This confirms the URL shape itself (`?cycle=true`) resolves to
        // that same clean markup rather than something unique to it.
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?cycle=true`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.standings-table')).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: false,
                viewport: vp.name,
                overlapSelectors: ['.heat-card', '.standing-row'],
            });
        });
    });

    test('Projector', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?projector=true`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.projector-grid')).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: true,
                viewport: vp.name,
                overlapSelectors: ['.projector-racer-card'],
            });
        });
    });

    /**
     * Projector Mode on a portrait tablet (#1143): the ordinary two-column
     * layout (`.projector-grid`, `.projector-left-col`/`.projector-right-col`)
     * pushed Current Standings partially or entirely off-screen at 820×1180
     * — the left column's heat cards refused to shrink below their own
     * content width, so the right column was pushed out past the viewport's
     * own edge. `displayDensity.ts`'s `projectorStacked` (aspect ratio < 1)
     * switches to a stacked layout (`.projector-stacked`) instead: heat
     * cards on top, Current Standings underneath with a row count measured
     * to fit rather than a fixed Top 5.
     *
     * 1180×820 is landscape (aspect ratio 1.44) and deliberately stays on
     * the *ordinary* two-column layout — included here because it sits just
     * outside every `VIEWPORTS` entry above, at the size the issue found
     * closest to the two-column layout's own limits, so this is where a
     * regression to that layout's own arithmetic would first show up.
     */
    test('Projector, a portrait tablet or the two-column layout at its own edge (#1143)', async ({ page }) => {
        const cases = [
            { name: '820x1180 (portrait tablet)', width: 820, height: 1180, stacked: true },
            { name: '768x1024 (portrait tablet)', width: 768, height: 1024, stacked: true },
            { name: '1180x820 (landscape, two-column)', width: 1180, height: 820, stacked: false },
        ];
        for (const c of cases) {
            await page.setViewportSize({ width: c.width, height: c.height });
            await page.goto(`/race/${raceId}/observation?projector=true`);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('.projector-mode')).toBeVisible();
            await expect(page.locator(c.stacked ? '.projector-stacked' : '.projector-grid')).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: true,
                viewport: c.name,
                overlapSelectors: ['.projector-racer-card', '.projector-standing-row'],
            });

            const rightCol = page.locator('.projector-right-col');
            await expect(rightCol).toBeVisible();
            const rightBox = await rightCol.boundingBox();
            expect(rightBox, `at ${c.name}: .projector-right-col has no bounding box`).not.toBeNull();
            expect(
                rightBox!.x + rightBox!.width,
                `at ${c.name}: standings column's right edge (${(rightBox!.x + rightBox!.width).toFixed(1)}) exceeds the viewport width (${c.width})`,
            ).toBeLessThanOrEqual(c.width + 1);

            const rowCount = await page.locator('.projector-standing-row').count();
            expect(rowCount, `at ${c.name}: no .projector-standing-row rendered`).toBeGreaterThanOrEqual(1);

            const overflow = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
                clientWidth: document.documentElement.clientWidth,
                clientHeight: document.documentElement.clientHeight,
            }));
            expect(overflow.scrollWidth, `at ${c.name}: horizontal overflow`).toBeLessThanOrEqual(
                overflow.clientWidth + 1,
            );
            expect(overflow.scrollHeight, `at ${c.name}: vertical overflow`).toBeLessThanOrEqual(
                overflow.clientHeight + 1,
            );
        }
    });

    test('Racer photos (the slideshow)', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=slideshow`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('slideshow')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name });
        });
    });

    test('Standings only', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=standings_only`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('standings-only-view')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name, overlapSelectors: ['.standing-row'] });
        });
    });

    test('Check-in progress', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=checkin`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('checkin-view')).toBeVisible();
            await assertCleanRender(page, {
                fullScreen: true,
                viewport: vp.name,
                overlapSelectors: ['[data-testid^="checkin-group-"]'],
                racerNames: pendingRacerNames,
            });
        });
    });

    test('QR code', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=qrcode`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('qrcode-view')).toBeVisible();
            // No racer name/car number/place/time on this view at all — the
            // legibility floor has nothing to check here, so an empty list
            // is passed explicitly rather than the seeded roster's names.
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name, racerNames: [] });
        });
    });

    test('Broadcast overlay (OBS)', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation?view=overlay`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('overlay-view')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name });
        });
    });

    test('Awards ceremony', async ({ page }) => {
        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/awards/present`);
            await page.waitForLoadState('networkidle');
            // Either slide is fine — the resolved SPEED award's winner, or
            // the unresolved SPECIAL one's "Still to be decided" — both are
            // exercised across the two awards seeded above, and which one the
            // operator's own step lands on first is not this test's concern;
            // waiting on the back link is enough to know a slide has rendered.
            await expect(page.getByTestId('ceremony-back-link')).toBeVisible();
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name });
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
            await forEachViewport(page, async (vp) => {
                await page.goto(`/race/${raceId}/observation`);
                await page.waitForLoadState('networkidle');
                await expect(page.getByTestId('intermission-overlay')).toBeVisible();
                await assertCleanRender(page, { fullScreen: true, viewport: vp.name });
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
        await assertCleanRender(page, {
            fullScreen: true,
            viewport: VIEWPORTS[0].name,
            overlapSelectors: ['.overlay-result-item'],
        });
    });

    test('Race complete!', async ({ page, request }) => {
        const unrecorded = (await readHeats(request, raceId)).filter((h) => h.recordedAt === null);
        for (const heat of unrecorded) {
            await recordHeat(request, heat, carNumberById);
        }

        await forEachViewport(page, async (vp) => {
            await page.goto(`/race/${raceId}/observation`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId('race-finished-overlay')).toBeVisible({ timeout: 10000 });
            await assertCleanRender(page, { fullScreen: true, viewport: vp.name });
        });
    });
});

/**
 * Pins the geometric check in `verticalOverflowFailures` directly, against
 * a synthetic `page.setContent` page rather than the seeded race — this is
 * the gate that survives the real observation views changing shape, and
 * the three cases the #1273 mutation-test paragraph asks for. Fixed pixel
 * heights throughout, no text, so nothing here depends on font rasterising
 * differently between machines the way the original flake did.
 *
 * Case 1 reproduces the #1273 shape exactly: a `::after` pseudo-element
 * (rendered, so it inflates `scrollHeight`, but never reachable by
 * `querySelectorAll('*')`, so the geometry walk finds no real descendant to
 * blame) pushes `scrollHeight` 2px past `clientHeight` while the one real
 * child stays fully inside — the old `scrollHeight <= clientHeight + 1`
 * check alone would have passed this at 1px of tolerance and failed it at
 * 2px; the new check passes it regardless, because nothing is clipped.
 */
test.describe('verticalOverflowFailures — synthetic cases (#1273)', () => {
    test('a scrollHeight/clientHeight mismatch with every child inside is not a clip', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: hidden; }
                .wrap::after { content: ''; display: block; height: 4px; }
                .child { height: 48px; }
            </style>
            <div class="wrap"><div class="child"></div></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad, bad.join('\n')).toEqual([]);
    });

    test('a child genuinely outside an overflow:hidden box is flagged, naming it', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: hidden; }
                .offender { height: 55px; }
            </style>
            <div class="wrap"><div class="offender"></div></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad.length, bad.join('\n')).toBe(1);
        expect(bad[0]).toContain('DIV.wrap clips its content');
        expect(bad[0]).toContain('DIV.offender overshoots the bottom edge by 5.0px');
    });

    test('the identical child inside an overflow:visible box is not a clip', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: visible; }
                .offender { height: 55px; }
            </style>
            <div class="wrap"><div class="offender"></div></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad, bad.join('\n')).toEqual([]);
    });
});

/**
 * Pins the [#1333](https://github.com/dknowles2/trusty-track/issues/1333)
 * fix directly: only *leaf* descendants (no child elements) are geometry
 * candidates, and a leaf's own vertical tolerance is a quarter of its
 * computed `line-height` (floored at 1px) rather than a flat 1px on
 * whichever descendant anywhere in the subtree happens to poke out
 * furthest. See `verticalOverflowFailures`'s own comment for why a
 * container element — concretely, a `<table>` under `border-collapse:
 * collapse` — is excluded rather than merely given more slack: its own
 * generated border box is a layout-engine computation with no relationship
 * to whether a reader can see the row inside it.
 */
test.describe('verticalOverflowFailures — synthetic cases (#1333)', () => {
    /**
     * Reproduces the exact #1273/#1333 mechanism, deterministically: a
     * `border-bottom` on the `<table>` element (kept out of `border-collapse`
     * folding by being fully transparent, so it changes no pixel on screen)
     * decouples the table's own border box from its one row's box by a
     * fixed, font-independent 1.5px — measured, not guessed, the same way
     * the real `.standings-table` under `border-collapse: collapse` gets a
     * generated border box that isn't bounded by its rows. `scrollHeight`
     * (23) exceeds `clientHeight` (21) by more than the 1px candidate
     * filter, so this reaches the geometry walk; the old walk would have
     * flagged `TABLE` at a 2.0px overshoot past its 1px flat tolerance —
     * exactly the shape of both prior failures. The new walk never
     * considers `TABLE` (it has child elements, so it isn't a leaf) and the
     * one leaf it does consider — `TD.cell`, the actual rendered content —
     * overshoots by only 0.5px, comfortably inside its own tolerance.
     */
    test('a <table> whose own border box overshoots while its content stays inside is not a clip', async ({
        page,
    }) => {
        await page.setContent(`
            <style>
                body { margin: 0; }
                .wrap { width: 200px; height: 21px; overflow: hidden; }
                table { border-collapse: collapse; border-bottom: 3px solid transparent; }
                td { height: 20px; line-height: 20px; padding: 0; }
            </style>
            <div class="wrap"><table><tbody><tr><td class="cell">x</td></tr></tbody></table></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad, bad.join('\n')).toEqual([]);
    });

    /**
     * The tolerance boundary itself, pinned exactly: `.offender`'s computed
     * `line-height` is `20px`, so its own tolerance is
     * `max(1, 20 * 0.25) = 5px`. A `55.5px`-tall child inside a `50px`
     * wrapper overshoots by `5.5px` — `0.5px` past its own tolerance — and
     * is flagged; a `54.5px`-tall child overshoots by `4.5px` — `0.5px`
     * *under* its own tolerance — and is not. Same wrapper, same
     * `line-height`, 1px apart in the child's own height either side of the
     * line.
     */
    test('a leaf just over its own line-height-scaled tolerance is flagged', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: hidden; }
                .offender { height: 55.5px; line-height: 20px; }
            </style>
            <div class="wrap"><div class="offender"></div></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad.length, bad.join('\n')).toBe(1);
        expect(bad[0]).toContain('DIV.wrap clips its content');
        expect(bad[0]).toContain('DIV.offender overshoots the bottom edge by 5.5px (tolerance 5.0px)');
    });

    test('the same leaf just under its own line-height-scaled tolerance is not a clip', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: hidden; }
                .offender { height: 54.5px; line-height: 20px; }
            </style>
            <div class="wrap"><div class="offender"></div></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad, bad.join('\n')).toEqual([]);
    });

    /**
     * The strictness half of the mutation test the issue asks for: a real
     * three-row table (`border-collapse: collapse`, no decoupling trick)
     * whose wrapper is cut by 20px — `scrollHeight=60`, `clientHeight=40` —
     * still gets flagged. The last row's own cell overshoots by a full
     * `20.0px`, far past even its own generous `5px` tolerance
     * (`line-height: 20px`), so scoping the walk down to leaf content does
     * not let a genuinely cropped row through.
     */
    test('a table wrapper genuinely cut by ~20px is still flagged, on its last row', async ({ page }) => {
        await page.setContent(`
            <style>
                body { margin: 0; }
                .wrap { width: 200px; height: 40px; overflow: hidden; }
                table { border-collapse: collapse; width: 100%; }
                td { height: 20px; line-height: 20px; padding: 0; }
            </style>
            <div class="wrap"><table><tbody>
                <tr><td class="cell">row 1</td></tr>
                <tr><td class="cell">row 2</td></tr>
                <tr><td class="cell">row 3</td></tr>
            </tbody></table></div>
        `);
        const bad = await verticalOverflowFailures(page);
        expect(bad.length, bad.join('\n')).toBe(1);
        expect(bad[0]).toContain('DIV.wrap clips its content');
        expect(bad[0]).toContain('TD.cell overshoots the bottom edge by 20.0px (tolerance 5.0px)');
    });

    /**
     * The viewport label itself, since #1333's own "small thing" is that a
     * failure didn't say where it happened. `assertCleanRender` threads
     * `opts.viewport` through to this function; called directly (as the
     * real spec never does), an absent label is simply omitted rather than
     * rendered as `[undefined]`.
     */
    test('a viewport label is prefixed onto the failure message when given', async ({ page }) => {
        await page.setContent(`
            <style>
                .wrap { width: 200px; height: 50px; overflow: hidden; }
                .offender { height: 55px; }
            </style>
            <div class="wrap"><div class="offender"></div></div>
        `);
        const bad = await verticalOverflowFailures(page, '1280x720 (720p TV)');
        expect(bad.length, bad.join('\n')).toBe(1);
        expect(bad[0]).toContain('[1280x720 (720p TV)] DIV.wrap clips its content');
    });
});
