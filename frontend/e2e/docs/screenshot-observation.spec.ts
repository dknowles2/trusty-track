/**
 * The audience-display screenshots, for docs/audience-display.md and
 * docs/reference/display-views.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-observation.spec.ts
 *
 * Split out of `race-day.spec.ts`, which raced a whole event through the
 * browser and then photographed the observation page at the end of it. These
 * pictures only need *a race that has finished*, which the API builds in a
 * couple of seconds — so they no longer wait on the race-day chain and the two
 * run side by side.
 *
 * It races on a **track of its own**. Two of these pictures are about the
 * record-break banner, whose baseline is every other race the track has ever
 * seen; on the shared track its content would depend on which other specs had
 * run, which is exactly the churn the seeding work exists to prevent.
 *
 * `observation/04` (the staging panels) is not here. It can only be taken
 * while there is a heat after next, so it belongs mid-round and stays in
 * `race-day.spec.ts`.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    ensureConfigured,
    gql,
    ownTrack,
    readHeats,
    readRounds,
    recordEveryHeat,
    runRoundWizard,
    seedRacingGroups,
    seedHistoricalRecord,
    seedRace,
    seedRacers,
} from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(
    __dirname,
    '../../../docs/assets/screenshots/observation',
);

/**
 * One of the app's own sample images, as a data URL.
 *
 * Read from disk rather than inlined: these are the illustrations
 * `populateRace` hands out, so the slideshow looks like a real event rather
 * than like a test fixture.
 */
function sampleImage(kind: 'racers' | 'cars'): string {
    const dir = path.resolve(__dirname, '../../../backend/assets/defaults', kind);
    const file = fs.readdirSync(dir).filter((name) => name.endsWith('.png')).sort()[0];
    return `data:image/png;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;
}

const DENS = [
    { name: 'Wolves', color: '#8B4513', rank: 'WOLF' },
    { name: 'Bears', color: '#1E5631', rank: 'BEAR' },
];

// Listed fastest first; the times below are assigned in this order, so the
// standings are this order. Every one is under the 3.899 seeded below, so the
// record breaks — deterministically, on this spec's own track.
const RACERS = [
    { first: 'Ada', last: 'Lovelace', car: 3, carName: 'Blue Streak', racingGroup: 'Bears' },
    { first: 'Grace', last: 'Hopper', car: 7, carName: 'Thunderbolt', racingGroup: 'Wolves' },
    { first: 'Alan', last: 'Turing', car: 11, carName: 'Silver Arrow', racingGroup: 'Wolves' },
    { first: 'Katherine', last: 'Johnson', car: 14, carName: 'Red Comet', racingGroup: 'Bears' },
    { first: 'Mae', last: 'Jemison', car: 18, carName: 'Night Owl', racingGroup: 'Wolves' },
    { first: 'Chien-Shiung', last: 'Wu', car: 22, carName: 'Green Machine', racingGroup: 'Bears' },
    { first: 'Rosalind', last: 'Franklin', car: 26, carName: 'Gold Rush', racingGroup: 'Wolves' },
    { first: 'Percy', last: 'Julian', car: 31, carName: 'Copper Bolt', racingGroup: 'Bears' },
];

/** Slower than any car above, so the record it sets is a real break. */
const PREVIOUS_RECORD = 3.899;

test('screenshot the audience displays', async ({ page, browser }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1200, height: 800 });
    await ensureConfigured(page);

    const trackId = await ownTrack(page, 'Audience Display Track');
    await seedHistoricalRecord(page, trackId, PREVIOUS_RECORD);

    const raceId = await seedRace(page, {
        name: 'Pack 42 Display Derby',
        trackId,
        dateTime: '2026-03-07T10:00:00',
        location: 'School Gym',
    });
    const racingGroupIds = await seedRacingGroups(page, raceId, DENS);
    const racerIds = await seedRacers(page, raceId, RACERS, racingGroupIds);
    const timeOf = new Map(
        RACERS.map((racer, index) => [racerIds[racer.car], 3.02 + index * 0.11]),
    );

    await runRoundWizard(page, raceId, { championshipRacers: 3 });

    // Every heat but the last three. The observation page is about what is on
    // the track *now* — "Now Racing", "On Deck" and "After That", which is what
    // the caption beneath picture 01 claims it shows — and a race with nothing
    // left to run has only the first of those. Three unfinished heats is the
    // fewest that fills all three panels.
    const rounds = await readRounds(page, raceId);
    const prelim = rounds.find((round) => round.advancementSource === null)!;
    const prelimHeats = (await readHeats(page, raceId)).filter(
        (heat) => heat.roundId === prelim.id,
    );
    await recordEveryHeat(page, prelimHeats.slice(0, -3), timeOf);

    // 01: the full observation page.
    await page.goto(`/race/${raceId}/observation`);
    await expect(page.locator('.heat-card').first()).toBeVisible();
    // Assert the two staging panels rather than trusting the seeding: the
    // caption beneath this picture names all three, and a page that had run out
    // of heats would still screenshot perfectly well.
    await expect(page.locator('.heat-cards-layout')).toHaveAttribute('data-on-deck-count', '2');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-observation-overview.png') });

    // 09: the photo slideshow (#175). The photos are seeded here rather than
    // relied upon, because this is the only shot that depends on a racer
    // having an image — and a screenshot that silently documents the empty
    // state is exactly the failure the audit of this suite kept turning up.
    const racerPhoto = sampleImage('racers');
    const carPhoto = sampleImage('cars');
    for (const racer of RACERS.slice(0, 4)) {
        const head = await gql<{ uploadImage: string }>(
            page,
            `mutation DisplayHead($d: String!) { uploadImage(dataUrl: $d) }`,
            { d: racerPhoto },
        );
        const car = await gql<{ uploadImage: string }>(
            page,
            `mutation DisplayCar($d: String!) { uploadImage(dataUrl: $d) }`,
            { d: carPhoto },
        );
        await gql(
            page,
            `mutation DisplayPhotos($id: Int!, $racer: RacerInput!) {
                updateRacer(id: $id, racer: $racer) { id }
            }`,
            {
                id: racerIds[racer.car],
                racer: {
                    firstName: racer.first,
                    lastName: racer.last,
                    racerImageUrl: head.uploadImage,
                    carImageUrl: car.uploadImage,
                },
            },
        );
    }

    await page.goto(`/race/${raceId}/observation?view=slideshow`);
    // Wait for a slide rather than for the network: the empty state and the
    // loading state look alike at a glance, and a screenshot taken during the
    // first fetch would document the wrong one.
    await expect(page.getByTestId('slideshow')).toBeVisible();
    await expect(page.getByTestId('slideshow').locator('img').first()).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-slideshow.png') });

    // 08: the operator's list of displays (#174). A display registers by
    // holding its subscription open, so the screen has to stay open in a
    // second context while this page is captured — navigating this one away
    // closes the socket and the row honestly, but unhelpfully, reads
    // "Not connected".
    //
    // The list is composed rather than photographed as it has accumulated:
    // every context that has sat on an observation page is registered by now,
    // so the row count would otherwise follow how many this run happened to
    // open.
    //
    // This tab goes to Race Control *first*: it is a display too while it sits
    // on the Live page, and clearing one whose socket is still open just brings
    // it back.
    await page.goto(`/race/${raceId}/control/displays`);
    await page.waitForLoadState('networkidle');

    const registered = await gql<{ displays: Array<{ displayId: string }> }>(
        page,
        `query DisplayKnown($id: Int!) { displays(raceId: $id) { displayId } }`,
        { id: raceId },
    );
    for (const known of registered.displays ?? []) {
        await gql(page, `mutation DisplayForget($id: String!) { forgetDisplay(displayId: $id) }`, {
            id: known.displayId,
        });
    }

    // A screen that has since dropped off the wifi, which is the row the prose
    // beside this picture is about — and the reason nothing removes one
    // automatically.
    const goneContext = await browser.newContext();
    const goneScreen = await goneContext.newPage();
    await goneScreen.goto(`/race/${raceId}/observation`);
    await goneScreen.waitForLoadState('networkidle');
    await expect(goneScreen.locator('.heat-card').first()).toBeVisible();
    await goneContext.close();

    const displayContext = await browser.newContext();
    const audienceScreen = await displayContext.newPage();
    await audienceScreen.goto(`/race/${raceId}/observation`);
    await audienceScreen.waitForLoadState('networkidle');
    await expect(audienceScreen.locator('.heat-card').first()).toBeVisible();

    // Name them, which is what the page beside this picture tells operators to
    // do — "a list of Display 1, Display 2, Display 3 is no help when you are
    // trying to change the one at the back".
    const toName = await gql<{ displays: Array<{ displayId: string; connected: boolean }> }>(
        page,
        `query DisplayNames($id: Int!) { displays(raceId: $id) { displayId connected } }`,
        { id: raceId },
    );
    for (const known of toName.displays ?? []) {
        await gql(
            page,
            `mutation DisplayRename($id: String!, $name: String!) {
                renameDisplay(displayId: $id, name: $name) { displayId }
            }`,
            { id: known.displayId, name: known.connected ? 'Gym north' : 'By the doors' },
        );
    }

    // The ceremony is offered as a view only once a race has an award to
    // announce, so this race needs one before picture 11 can be taken. Seeded
    // before the reload below, which is what the panel re-reads it on.
    await gql(
        page,
        `mutation DisplayAward($id: Int!, $award: AwardInput!) {
            createAward(raceId: $id, award: $award) { id }
        }`,
        { id: raceId, award: { name: 'Fastest Car', kind: 'SPEED', source: 'ALL', place: 1 } },
    );

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid^="display-"]').first().getByText('Gym north')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-displays-panel.png') });

    // 11: the ceremony controls on a display row. Taken after 08 rather than
    // instead of it — 08 is the panel's ordinary look, and a row parked on the
    // ceremony is not it. Assigning navigates the audience screen to the
    // ceremony route, which is fine: it is closed a moment later.
    // By name, not `.first()`: assigning the ceremony navigates the audience
    // screen to its own route, and while its subscription crosses that gap the
    // row briefly counts as disconnected — the list re-sorts (connected first,
    // then name) and "By the doors" takes the top slot for a beat. A `.first()`
    // locator re-resolves at every use, so the screenshot could clip whichever
    // row had just landed there.
    const displayRow = page.locator('[data-testid^="display-"]', { hasText: 'Gym north' });
    await displayRow.getByRole('combobox').selectOption('AWARDS');
    await expect(displayRow.getByRole('button', { name: /Next award/ })).toBeVisible();
    // Wait for the reconnect to settle the ordering before measuring the clip,
    // or the row can move between boundingBox() and the screenshot.
    await expect(page.locator('[data-testid^="display-"]').first()).toContainText('Gym north');
    const rowBox = await displayRow.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '11-ceremony-controls.png'),
        ...(rowBox
            ? { clip: { x: rowBox.x, y: rowBox.y, width: rowBox.width, height: rowBox.height } }
            : {}),
    });

    await displayContext.close();

    await page.goto(`/race/${raceId}/observation`);
    await expect(page.locator('.heat-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    // 02: the race navigation, which is what the section around it is about —
    // finding the Live tab. It used to be a second copy of 01, captioned as
    // showing a URL that a Playwright screenshot cannot contain (#144).
    //
    // `page.locator('nav').last()` used to be `.first()` too, since the page
    // has exactly one `<nav>` element — the top header bar with the logo and
    // the race picker. The row holding the Live tab is a `<div
    // data-testid="race-nav">` underneath it (Navigation.tsx), so that lookup
    // always captured the header and never the tabs the caption points at.
    const raceNav = page.getByTestId('race-nav');
    await expect(raceNav.getByRole('link', { name: /Live/i })).toBeVisible();
    const navBox = await raceNav.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '02-observation-url.png'),
        ...(navBox ? { clip: { x: 0, y: 0, width: 1200, height: navBox.y + navBox.height + 10 } } : {}),
    });

    // 03: the "Now Racing" card area.
    const nowRacingCard = page.locator('.heat-card').first();
    const cardBox = await nowRacingCard.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '03-now-racing-panel.png'),
        ...(cardBox
            ? { clip: { x: cardBox.x, y: cardBox.y, width: cardBox.width, height: cardBox.height } }
            : {}),
    });

    // Ensure the Standings tab is active. This is the *observation page's* own
    // standings/timing tab, not the race-mode toggle that #186 removed — it is
    // still a button, and clicking the navigation link instead navigates away
    // from the page being screenshotted.
    await page.getByRole('button', { name: /Standings/i }).click();

    // 05: the standings table itself, not another copy of the whole page (#144).
    const standingsTable = page.locator('table').first();
    await expect(standingsTable).toBeVisible();
    await standingsTable.scrollIntoViewIfNeeded();
    const standingsBox = await standingsTable.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '05-live-leaderboard.png'),
        ...(standingsBox
            ? {
                  clip: {
                      x: 0,
                      y: standingsBox.y - 60,
                      width: 1200,
                      height: Math.min(standingsBox.height + 80, 700),
                  },
              }
            : {}),
    });

    // 06: the "Launch Projector Mode" button, which is what the caption points
    // at — this was a fifth copy of the full page (#144).
    await page.evaluate(() => window.scrollTo(0, 0));
    const projectorButton = page.getByRole('button', { name: /Launch Projector Mode/i });
    await expect(projectorButton).toBeVisible();
    const buttonBox = await projectorButton.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '06-projector-mode-button.png'),
        ...(buttonBox
            ? { clip: { x: 0, y: 0, width: 1200, height: buttonBox.y + buttonBox.height + 20 } }
            : {}),
    });

    // 07: projector mode — opens in a new tab, caught with the heat-results
    // overlay up, which is what the caption claims. The overlay is an *edge*,
    // not a state (#335, #392): a freshly opened projector treats the
    // subscription's opening payload as history and shows nothing — so the
    // heat has to finish while this tab is watching. Record the next pending
    // heat once the page has settled; its times are the seeded ones, all under
    // the historical record, so the banner over the overlay says the same
    // thing on every run.
    const newPagePromise = page.context().waitForEvent('page');
    await projectorButton.click();
    const projectorPage = await newPagePromise;
    await projectorPage.waitForLoadState('networkidle');
    await expect(projectorPage.locator('.heat-card, .projector-mode').first()).toBeVisible();
    await recordEveryHeat(page, prelimHeats.slice(-3, -2), timeOf);
    await expect(projectorPage.getByText('Heat Results')).toBeVisible();
    await expect(projectorPage.getByText('New track record!')).toBeVisible();
    // `animations: 'disabled'` by hand: the fixture in `screenshots-setup.ts`
    // wraps the spec's own page, and this is a second tab the app opened.
    await projectorPage.screenshot({
        path: path.join(SCREENSHOT_DIR, '07-projector-mode-full.png'),
        animations: 'disabled',
    });
    await projectorPage.close();

    // No 09 of the whole page. It was a sixth copy captioned "without photos",
    // which is honest only because that fixture had none, and is therefore
    // exactly what 01 already shows. That section points at 01 now (#144).

    // 10: the record banner on the Timing Stats view. The baseline is the
    // record as it stood before today, which on this spec's own track is the
    // single historical entry seeded above — so the break is the same break on
    // every run, and it is what puts the banner over the projector overlay in
    // 07 as well.
    await page.goto(`/race/${raceId}/observation?view=timing`);
    await page.waitForLoadState('networkidle');
    const bannerLocator = page.getByTestId('timing-record-banner');
    await expect(bannerLocator).toBeVisible();
    // The banner sits below the fold on this viewport (the lane results above
    // it push it past 800px), so `boundingBox()` reported a y past the bottom
    // of what `page.screenshot()` actually captures — the clip below was
    // computed correctly against coordinates the screenshot never rendered,
    // which is what clipped the banner out entirely. Scroll it into view
    // first, matching what every other clipped shot in this spec does through
    // `scrollIntoViewIfNeeded` or by construction.
    await bannerLocator.scrollIntoViewIfNeeded();
    const recordBanner = await bannerLocator.boundingBox();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '10-record-banner.png'),
        ...(recordBanner
            ? {
                  clip: {
                      x: 0,
                      y: Math.max(0, recordBanner.y - 70),
                      width: 1200,
                      height: recordBanner.height + 100,
                  },
              }
            : {}),
    });
});
