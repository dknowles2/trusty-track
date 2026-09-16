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
        await displayPage.waitForTimeout(300);
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
