/**
 * Screenshots for docs/instant-replay.md (#177 stage 1b).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-instant-replay.spec.ts
 *
 * No CI runner has a camera, so these go through `/camera?fake=1` —
 * `FakeCamera` in `Camera.tsx` — which bypasses `getUserMedia` and
 * `MediaRecorder` entirely and uploads `frontend/public/fake-camera.webm`
 * on every result, through the same bounds-computation and upload path a
 * real capture takes. The fake timer (`fakeTimerStart`/`fakeTimerFinish`,
 * `support.ts`'s `runFakeHeat`) drives the `timerStatus` transitions the
 * camera's own sync math reads, exactly as a real timer would.
 *
 * **Two warm-up heats, not one**, matching
 * `frontend/e2e/functional/instantReplay.spec.ts`'s own header comment:
 * `observeHeatResult`'s `seen === null` rule (`resultsOverlay.ts`, reused for
 * both `timingStats` and `heatReplay`) treats the first payload a fresh
 * subscription receives as history, not news. The first warm-up heat moves
 * the *camera's* own `seenHeatResult` off `null` so it starts capturing; the
 * second is what actually produces this race's first clip, which is in turn
 * the *display's* own subscription's opening `heatReplay` payload and is
 * swallowed by the identical rule there. Only the third heat is a clip a
 * freshly opened display treats as news and plays.
 *
 * Races on a track of its own (`ownTrack`) rather than the shared
 * `docsTrackId` — not for record-keeping (this spec has no interest in
 * records), but so no other spec's heats add `timerStatus` transitions or
 * `timingStats` payloads to the log this camera reads while it is capturing.
 */

import { test, expect, screenshotLocator } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    deleteTrack,
    ensureConfigured,
    gql,
    ownTrack,
    readHeats,
    runFakeHeat,
    runRoundWizard,
    seedRace,
} from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/instant-replay');

/** `displayIdentity.ts`'s own storage key — mirrored here, same as
 * `screenshot-observation.spec.ts`'s copy, since this file runs outside the
 * app's build and cannot import it. Fixed ids so the whimsical name each
 * device draws (`domain/display_names.whimsical_name`, seeded from the id)
 * is stable between runs rather than a fresh animal every time. */
const DISPLAY_ID_KEY = 'trustytrack.displayId';
const CAMERA_DISPLAY_ID = 'trustytrack-docs-screenshot-camera';
const AUDIENCE_DISPLAY_ID = 'trustytrack-docs-screenshot-replay-display';

/**
 * `support.ts`'s `runFakeHeat` sends only `fakeTimerStart`/`fakeTimerFinish`
 * — right for `race-day.spec.ts`, where `RaceExecution.tsx` has already
 * armed the heat on screen (`.claude/rules/race-day-ui.md`: "the operator
 * screen arms the heat itself"). This spec drives every heat purely through
 * the API with no operator screen open at all, so it has to arm the heat
 * itself first — `fakeTimerStart` is a silent no-op (returns `false`, which
 * `gql`'s caller here never checks) against a heat that is not `ARMED`.
 */
async function prepareAndRunFakeHeat(page: import('@playwright/test').Page, heatId: number): Promise<void> {
    await gql(page, `mutation IRDocsPrep($heatId: Int!) { prepareHeat(heatId: $heatId) }`, { heatId });
    await runFakeHeat(page, heatId);
}

test('screenshot instant replay', async ({ page, browser }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await ensureConfigured(page);

    const retry = test.info().retry;
    const trackName = retry > 0 ? `Instant Replay Track (retry ${retry})` : 'Instant Replay Track';
    const trackId = await ownTrack(page, trackName, 4, 'FAKE');

    try {
        const raceId = await seedRace(page, {
            name: 'Instant Replay Docs Derby',
            trackId,
            dateTime: '2026-04-18T10:00:00',
            location: 'School Gym',
            carNumberingStrategy: 'GLOBAL',
        });

        // A small, believable roster — this race only needs enough heats for
        // two warm-ups and one heat under test, and `populateRace` gives
        // every racer a photo, the same as the observation and stats specs,
        // so this doesn't look like a test fixture.
        await gql(
            page,
            `mutation ReplayRoster($raceId: Int!, $config: PopulateTestDataInput!) {
                populateRace(raceId: $raceId, config: $config)
            }`,
            {
                raceId,
                config: {
                    count: 6,
                    addRacerPhotos: true,
                    addCarPhotos: true,
                    assignRacingGroups: true,
                    checkIn: true,
                },
            },
        );
        await runRoundWizard(page, raceId);
        const heats = (await readHeats(page, raceId))
            .filter((heat) => heat.roundId !== null)
            .sort((a, b) => a.id - b.id);
        expect(heats.length).toBeGreaterThanOrEqual(3);
        const [warmUp1, warmUp2, underTest] = heats;

        // The camera, in its own browser context — a second device, exactly
        // as it is in a real gym.
        const cameraContext = await browser.newContext();
        const cameraPage = await cameraContext.newPage();
        await cameraPage.setViewportSize({ width: 480, height: 800 });
        await cameraPage.addInitScript(
            ([key, value]) => window.localStorage.setItem(key, value),
            [DISPLAY_ID_KEY, CAMERA_DISPLAY_ID],
        );
        await cameraPage.goto(`/race/${raceId}/camera?fake=1`);
        await cameraPage.waitForLoadState('networkidle');
        await cameraPage.getByLabel('Which track this camera listens to').selectOption(String(trackId));
        await expect(cameraPage.getByTestId('camera-status-line')).toContainText('Listening to', {
            timeout: 15000,
        });

        // 01: the camera page, watching its track and ready to capture —
        // before any heat has run, which is what the guide's "happy path"
        // step 4 promises the page looks like. A full-page shot rather than
        // a locator: the page-level `.container` is not unique (the app's
        // own layout wraps everything in one too), and there's nothing else
        // on this page worth cropping out.
        await cameraPage.screenshot({ path: path.join(SCREENSHOT_DIR, '01-camera-page.png') });

        // The audience display, in a third context.
        const displayContext = await browser.newContext();
        const displayPage = await displayContext.newPage();
        await displayPage.addInitScript(
            ([key, value]) => window.localStorage.setItem(key, value),
            [DISPLAY_ID_KEY, AUDIENCE_DISPLAY_ID],
        );
        await displayPage.goto(`/race/${raceId}/observation`);
        await displayPage.waitForLoadState('networkidle');
        await expect(displayPage.locator('.heat-card').first()).toBeVisible();

        // Warm-up 1: swallowed by the camera's own `seenHeatResult` — no
        // clip is produced yet.
        await prepareAndRunFakeHeat(page, warmUp1.id);
        await cameraPage.waitForTimeout(2000);

        // Warm-up 2: the camera now captures and uploads — this race's
        // first clip, which is exactly what the display's own fresh
        // `heatReplay` subscription reads as its opening payload and
        // swallows in turn.
        const warmClipUpload = cameraPage.waitForResponse(
            (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
            { timeout: 30000 },
        );
        await prepareAndRunFakeHeat(page, warmUp2.id);
        await warmClipUpload;
        await displayPage.waitForTimeout(1000);

        // The heat under test — a genuinely new clip, which the display
        // treats as news.
        const uploadResponse = cameraPage.waitForResponse(
            (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
            { timeout: 30000 },
        );
        await prepareAndRunFakeHeat(page, underTest.id);
        await uploadResponse;
        await expect(cameraPage.getByTestId('camera-status-line')).toContainText('uploaded', {
            timeout: 15000,
        });

        // 04: the replay, playing on the audience display right after its
        // own results overlay.
        const video = displayPage.getByTestId('replay-video');
        await expect(video).toBeVisible({ timeout: 15000 });
        await displayPage.waitForTimeout(300);
        await displayPage.screenshot({ path: path.join(SCREENSHOT_DIR, '04-replay-playback.png') });

        // 02: the Displays panel, with the camera's row showing its track
        // and how long ago its last clip landed.
        await page.goto(`/race/${raceId}/displays`);
        await page.waitForLoadState('networkidle');
        const cameraRow = page.locator('[data-testid^="display-"]').filter({
            has: page.getByLabel(/Which track .* listens to/),
        });
        await expect(cameraRow.getByText(/Last clip/)).toBeVisible({ timeout: 15000 });
        await screenshotLocator(cameraRow, {
            path: path.join(SCREENSHOT_DIR, '02-displays-panel-camera.png'),
        });

        // 03: Race Control's own camera badge, above the lock banner —
        // reachable without leaving the heat the operator is running.
        await page.goto(`/race/${raceId}/control`);
        await page.waitForLoadState('networkidle');
        const badges = page.getByTestId('camera-badges');
        await expect(badges.getByText(/connected/)).toBeVisible({ timeout: 15000 });
        await screenshotLocator(badges, {
            path: path.join(SCREENSHOT_DIR, '03-race-control-badge.png'),
        });

        await cameraContext.close();
        await displayContext.close();
    } finally {
        await deleteTrack(page, trackId).catch(() => {});
    }
});
