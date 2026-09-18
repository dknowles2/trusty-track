/**
 * Screenshots for docs/instant-replay.md (#177 stage 1b, extended by
 * stages 2, 3 and 4).
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

/**
 * Pauses an autoplaying `<video>` (the results overlay on 04, the highlight
 * reel on 11) and seeks it to a fixed, repeatable point roughly halfway
 * through the clip, waiting for the seek to actually land before returning
 * (#1204).
 *
 * Before this, both screenshots were taken 300ms after the element became
 * *visible* while it was still playing — so which frame was on screen
 * depended on WebCodecs' own decode timing, not on anything committed.
 * Measured on two runs of this identical spec, seconds apart, on one
 * machine: 04 differed by 2173–28503 px (0.24–3.09%), 11 by 2097–28774 px
 * (2.40–3.12%). Neither picture's caption in `docs/instant-replay.md`
 * promises a *particular* instant of the clip — 04's says only "muted,
 * full-screen"; 11's only "playing a highlight clip with its caption" — so
 * any fixed, in-bounds frame is an equally honest picture of what the
 * overlay looks like; this one is simply the same frame every time.
 *
 * `el.duration` can read `Infinity` on a still-buffering WebM (see this
 * component's own note on `ReplayPlayer`'s `durationMs` prop for why), so
 * this waits for a finite one rather than trusting whatever is there the
 * instant the element became visible.
 *
 * Deliberately does not resume playback afterwards: `Observation.tsx`
 * renders the intermission branch ahead of the results-overlay/replay-player
 * markup whenever a break is active (`.claude/rules/displays.md`'s "a break
 * takes it over exactly like every other view"), so leaving 04's clip frozen
 * does not block the later intermission highlight from taking over the
 * screen, and nothing after 11's own screenshot reads `displayPage` again
 * before its context closes.
 */
async function pauseAndSeekToFixedFrame(video: import('@playwright/test').Locator): Promise<void> {
    await video.evaluate(async (el: HTMLVideoElement) => {
        el.pause();
        if (!isFinite(el.duration) || el.duration <= 0) {
            await new Promise<void>((resolve) => {
                el.addEventListener('loadedmetadata', () => resolve(), { once: true });
            });
        }
        // Halfway through the clip — comfortably inside its bounds whatever
        // its exact duration turns out to be, and away from the lead-in/
        // post-roll margins `clipBounds.ts` pads around the timed race
        // itself, where a keyframe boundary or the very first/last decoded
        // frame would be more likely to behave unusually.
        const target = Math.max(0.1, Math.min(el.duration - 0.1, el.duration / 2));
        if (!el.seeking && Math.abs(el.currentTime - target) < 0.001) {
            return;
        }
        await new Promise<void>((resolve) => {
            el.addEventListener('seeked', () => resolve(), { once: true });
            el.currentTime = target;
        });
    });
}

/**
 * The organization name and every existing track, reshaped into
 * `TrackInput`s — what `updateInitialConfig` needs sent back unchanged
 * alongside `keepReplays` below. `InitialConfigInput.tracks` is not
 * optional: an empty list is not "leave tracks alone", it is "delete every
 * track", which on this shared backend would take out every other spec's
 * own track along with it. `SystemSettings.tsx`'s own submit handler builds
 * this identical shape from the same query.
 */
async function currentConfigInput(
    page: import('@playwright/test').Page,
): Promise<{ organizationName: string; tracks: unknown[] }> {
    const data = await gql(
        page,
        `query IRDocsCurrentConfig {
            initialConfig {
                organizationName
                tracks {
                    id name laneCount lengthFeet timerType serialPort timerProfile
                    remoteStartInstalled reverseLanes scaleRatio showScaleSpeed laneColors
                }
            }
        }`,
    );
    return { organizationName: data.initialConfig.organizationName, tracks: data.initialConfig.tracks };
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
        // Two more than stage 1b needed — the fourth is what stage 2's own
        // "kept" clip runs on, and the fifth gives stage 3's highlight reel
        // a second clip to play (one alone would say nothing about the
        // "fastest first" ordering the guide's screenshot is meant to
        // show), once the setting is switched on.
        expect(heats.length).toBeGreaterThanOrEqual(5);
        const [warmUp1, warmUp2, underTest, storedHeat, storedHeat2] = heats;

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
        // own results overlay. Paused and seeked to a fixed frame first
        // (#1204) — see `pauseAndSeekToFixedFrame`'s own docstring for why.
        const video = displayPage.getByTestId('replay-video');
        await expect(video).toBeVisible({ timeout: 15000 });
        await pauseAndSeekToFixedFrame(video);
        await displayPage.waitForTimeout(100);
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

        // Stage 2 (#177): the "Keep replay clips" setting, and the ▶ it
        // puts on the Schedule tab. This is the one place in the docs
        // screenshot suite that turns an install-wide setting on for real
        // — every other spec in this parallel pool deliberately avoids
        // that (`screenshot-settings.spec.ts`'s own header comment) — but
        // stage 2's whole point is a *stored*, `Heat.replays`-backed clip,
        // which only exists once `keepReplays` was genuinely on at upload
        // time; the local-unsaved-state trick that captures the setting's
        // *checkbox* in `screenshot-settings.spec.ts` cannot produce one.
        // Reset in `finally` below, before any other cleanup, so no later
        // spec in the pool finds it still on.
        const configBase = await currentConfigInput(page);
        await gql(
            page,
            `mutation IRDocsKeepReplaysOn($config: InitialConfigInput!) {
                updateInitialConfig(config: $config) { keepReplays }
            }`,
            { config: { ...configBase, keepReplays: true } },
        );

        const storedClipUpload = cameraPage.waitForResponse(
            (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
            { timeout: 30000 },
        );
        await prepareAndRunFakeHeat(page, storedHeat.id);
        await storedClipUpload;

        // 06: the ▶ that shows up on the Schedule tab once this heat's clip
        // is a stored one, not merely a delete-after-next-heat one.
        await page.goto(`/race/${raceId}/control/schedule`);
        await page.waitForLoadState('networkidle');
        const replayButton = page.getByTestId(`heat-replay-btn-${storedHeat.id}`);
        await expect(replayButton).toBeVisible({ timeout: 15000 });
        const storedHeatRow = page.locator('tr', { has: replayButton });
        await screenshotLocator(storedHeatRow, {
            path: path.join(SCREENSHOT_DIR, '06-schedule-replay-button.png'),
        });

        // 12 (#177 stage 4): the ▶ modal, frozen on a finish-frame tick —
        // the timeline strip, the lane's caption, and the frozen video.
        // The fake clip is synthetic (no real finish line in the picture),
        // so this is the overlay-and-timeline shot promised in the guide,
        // not a claim about what the video itself shows.
        await replayButton.click();
        const replayDialog = page.getByRole('dialog');
        const finishVideo = replayDialog.getByTestId('replay-video');
        await expect(finishVideo).toBeVisible({ timeout: 15000 });
        const firstMark = replayDialog.locator('[data-testid^="replay-finish-mark-"]').first();
        await expect(firstMark).toBeVisible({ timeout: 15000 });
        await firstMark.click();
        await expect(replayDialog.getByTestId('replay-finish-caption')).toBeVisible({ timeout: 15000 });
        // `seekAndFreeze` (`ReplayPlayer.tsx`) sets `currentTime` and calls
        // `pause()` synchronously from the click handler, but a seek itself
        // is asynchronous — the frame actually on screen depends on when the
        // browser finishes decoding to that point, not on when the click
        // handler returned. Wait for the seek to genuinely land (`seeking`
        // false — already the case if it settled before this round trip
        // reached the browser, awaited via `seeked` otherwise) rather than a
        // fixed sleep guessing how long that takes (#1204: measured
        // 221–491 px, 0.08–0.18%, drifting between two runs under the old
        // `waitForTimeout(300)`).
        await finishVideo.evaluate((el: HTMLVideoElement) => {
            if (!el.seeking) return Promise.resolve();
            return new Promise<void>((resolve) => {
                el.addEventListener('seeked', () => resolve(), { once: true });
            });
        });
        await page.waitForTimeout(100);
        await screenshotLocator(replayDialog, {
            path: path.join(SCREENSHOT_DIR, '12-finish-frame.png'),
        });
        await replayDialog.getByRole('button', { name: '×' }).click();

        // Stage 3 (#177): a second stored clip in the same round, so the
        // highlight reel below has more than one heat to order.
        const secondStoredClipUpload = cameraPage.waitForResponse(
            (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
            { timeout: 30000 },
        );
        await prepareAndRunFakeHeat(page, storedHeat2.id);
        await secondStoredClipUpload;

        // 11: the break, playing on the audience display — the overlay
        // mid-clip, with its caption and the countdown's corner badge.
        // Started from Race Control's own compact break control, with
        // "Show replay highlights" left at its default (checked).
        await page.goto(`/race/${raceId}/control`);
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'Race', exact: true }).click();
        const intermissionToggle = page.getByTestId('intermission-toggle');
        await expect(intermissionToggle).toBeVisible({ timeout: 15000 });
        await intermissionToggle.click();
        const popover = page.getByTestId('intermission-popover');
        const highlightsCheckbox = popover.getByTestId('intermission-highlights-checkbox');
        await expect(highlightsCheckbox).toBeVisible({ timeout: 15000 });
        await expect(highlightsCheckbox).toBeChecked();
        await popover.getByTestId('intermission-preset-300').click();

        const highlightVideo = displayPage.getByTestId('replay-video');
        await expect(highlightVideo).toBeVisible({ timeout: 15000 });
        await expect(displayPage.getByTestId('intermission-highlight-caption')).toBeVisible({
            timeout: 15000,
        });
        await expect(displayPage.getByTestId('intermission-overlay-countdown-corner')).toBeVisible();
        // Paused and seeked to a fixed frame first (#1204) — same reasoning
        // as 04's own call, above.
        await pauseAndSeekToFixedFrame(highlightVideo);
        await displayPage.waitForTimeout(100);
        await displayPage.screenshot({
            path: path.join(SCREENSHOT_DIR, '11-intermission-highlights.png'),
        });

        await gql(page, `mutation IRDocsEndIntermission($raceId: Int!) { endIntermission(raceId: $raceId) { id } }`, {
            raceId,
        });

        await cameraContext.close();
        await displayContext.close();
    } finally {
        // The setting is install-wide; every other spec in this parallel
        // pool assumes it is off (the same reasoning
        // `screenshot-settings.spec.ts` states for never saving it there).
        await currentConfigInput(page)
            .then((configBase) =>
                gql(
                    page,
                    `mutation IRDocsKeepReplaysOff($config: InitialConfigInput!) {
                        updateInitialConfig(config: $config) { keepReplays }
                    }`,
                    {
                        config: {
                            ...configBase,
                            keepReplays: false,
                            clearReplayRetentionHeats: true,
                            clearReplayRetentionMb: true,
                        },
                    },
                ),
            )
            .catch(() => {});
        await deleteTrack(page, trackId).catch(() => {});
    }
});
