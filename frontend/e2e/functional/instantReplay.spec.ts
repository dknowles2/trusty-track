/**
 * Instant replay end to end (#177 stage 1b): a camera captures through
 * `FakeCamera` (`?fake=1`), uploads to `POST /replay/`, and a display with
 * `replays` on plays the clip back after its own results overlay.
 *
 * Two browser contexts beside the operator's, the same reason
 * `displays.spec.ts` uses two: a camera and a display are different
 * machines, and neither holds a PIN.
 *
 * **Every test warms up on one heat before the heat it actually asserts
 * on.** `observeHeatResult`'s own `seen === null` rule (`resultsOverlay.ts`,
 * reused here unchanged) treats the *first* non-null payload a fresh
 * subscription ever receives as history, not news — right for a screen
 * reconnecting mid-event, and it means the very first heat of a brand-new
 * race never fires the camera's own capture either, the same "edge, not a
 * state" property `screenshot-observation.spec.ts` already works around by
 * recording a heat "while the projector tab is watching." A warm-up heat
 * moves `seenHeatResult`/`seenReplay` off `null` before anything under
 * test is recorded.
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, gql, readHeats, seedRace, type Heat } from './support';

test.setTimeout(180_000);

async function openCamera(page: Page, raceId: number, id: string, extraParams = ''): Promise<void> {
    await page.goto(`/race/${raceId}/camera?fake=1&displayId=${id}${extraParams}`);
    await page.waitForLoadState('networkidle');
}

async function openObservation(page: Page, raceId: number, id: string) {
    await page.goto(`/race/${raceId}/observation?displayId=${id}`);
    await page.waitForLoadState('networkidle');
}

/** Two runs per lane, rather than `support.ts`'s own `createSchedule`
 * (one) — this spec wants at least three heats: a warm-up, the one under
 * test, and a third to prepare afterward and prove the clip is purged. */
async function scheduleWithSpareHeats(page: Page, raceId: number, runsPerLane = 2): Promise<void> {
    await gql(
        page,
        `mutation IRSchedule($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        { raceId, config: { generalRound: { type: 'ALL', runsPerLane }, championshipRounds: [] } },
    );
}

async function officialHeatsInOrder(page: Page, raceId: number): Promise<Heat[]> {
    const heats = await readHeats(page, raceId);
    return heats.filter((h) => h.roundId !== null).sort((a, b) => a.heatNumber - b.heatNumber);
}

async function runHeatToStart(page: Page, heatId: number): Promise<void> {
    await gql(page, `mutation IRPrep($heatId: Int!) { prepareHeat(heatId: $heatId) }`, { heatId });
    await gql(page, `mutation IRStart($heatId: Int!) { fakeTimerStart(heatId: $heatId) }`, { heatId });
}

async function finishHeat(page: Page, heatId: number): Promise<void> {
    await gql(page, `mutation IRFinish($heatId: Int!) { fakeTimerFinish(heatId: $heatId) }`, { heatId });
}

test('a camera uploads through FakeCamera, and a replays-on display plays the clip', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Playback Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(4);
    const [timingWarmUp, replayWarmUp, underTest, afterward] = heats;

    const cameraContext = await browser.newContext();
    const camera = await cameraContext.newPage();
    await openCamera(camera, raceId, 'spec-camera-playback');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-playback');

    // First warm-up: moves the camera's own `timingStats`-keyed `seen`
    // state off `null` — see this file's own header docs. Deliberately no
    // clip is asserted here; the whole point is that it is swallowed as
    // the subscription's own opening observation.
    await runHeatToStart(page, timingWarmUp.id);
    await finishHeat(page, timingWarmUp.id);
    await camera.waitForTimeout(2000);

    // Second warm-up: the camera now captures and uploads normally (its own
    // `seen` is warm), which produces this race's *first* clip — and a
    // first clip is exactly what a fresh `heatReplay` subscription's own
    // opening payload would be, so the *display*'s copy of the same rule
    // swallows it too. Needed once, for the display's own `seenReplay`.
    await runHeatToStart(page, replayWarmUp.id);
    const warmClipUpload = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await finishHeat(page, replayWarmUp.id);
    await warmClipUpload;
    await display.waitForTimeout(2000);

    // The heat under test.
    await runHeatToStart(page, underTest.id);
    const uploadResponse = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await finishHeat(page, underTest.id);
    const response = await uploadResponse;
    expect(response.status()).toBe(200);
    await expect(camera.getByTestId('camera-status-line')).toContainText('uploaded', { timeout: 15000 });

    // The display, with replays on by default, plays the clip.
    const video = display.getByTestId('replay-video');
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect(video).toHaveAttribute('src', /\/replay\//);

    // It shows twice (the default `showings`) and then disappears on its own.
    await expect(display.getByTestId('replay-player')).toBeHidden({ timeout: 60000 });

    // Preparing the next heat purges the previous heat's clip (#177 stage
    // 1a's retention rule) — nothing left for a fresh display to show.
    await runHeatToStart(page, afterward.id);
    const laterDisplay = await (await browser.newContext()).newPage();
    await openObservation(laterDisplay, raceId, 'spec-display-late');
    await laterDisplay.waitForTimeout(2000);
    await expect(laterDisplay.getByTestId('replay-video')).toHaveCount(0);
});

test('a display with replays off never shows the clip', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Off Race');
    await scheduleWithSpareHeats(page, raceId);
    const [warmUp, underTest] = await officialHeatsInOrder(page, raceId);

    const camera = await (await browser.newContext()).newPage();
    await openCamera(camera, raceId, 'spec-camera-off');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-off');

    // Turn replays off for this display before anything is recorded.
    await gql(
        page,
        `mutation IRAssignOff($displayId: String!) {
            assignDisplay(displayId: $displayId, view: STANDINGS, replays: false) { displayId }
        }`,
        { displayId: 'spec-display-off' },
    );

    await runHeatToStart(page, warmUp.id);
    await finishHeat(page, warmUp.id);
    await camera.waitForTimeout(2000);

    await runHeatToStart(page, underTest.id);
    const uploadResponse = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await finishHeat(page, underTest.id);
    await uploadResponse;

    // The clip exists (the camera uploaded it) — this display simply never
    // acts on it.
    await display.waitForTimeout(3000);
    await expect(display.getByTestId('replay-video')).toHaveCount(0);
});

test('a reconnecting display does not replay a result from before it reloaded', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Reconnect Race');
    await scheduleWithSpareHeats(page, raceId);
    const [warmUp, underTest] = await officialHeatsInOrder(page, raceId);

    const camera = await (await browser.newContext()).newPage();
    await openCamera(camera, raceId, 'spec-camera-reconnect');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-reconnect');

    await runHeatToStart(page, warmUp.id);
    await finishHeat(page, warmUp.id);
    await camera.waitForTimeout(2000);

    await runHeatToStart(page, underTest.id);
    const uploadResponse = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await finishHeat(page, underTest.id);
    await uploadResponse;

    // Let the clip actually finish uploading and the server settle before
    // reloading — the reconnect has to land *after* the clip already exists,
    // which is the case that must not replay.
    await display.waitForTimeout(2000);

    // A reload is a fresh subscription: `heatReplay`'s opening payload for
    // this new connection already names the clip that exists right now, and
    // the `seen === null` rule must treat that as history, not news.
    await display.reload();
    await display.waitForLoadState('networkidle');
    await display.waitForTimeout(3000);
    await expect(display.getByTestId('replay-video')).toHaveCount(0);
});

test('a clip cut long after the ring has evicted its own opening keyframe still plays', async ({ browser, page }) => {
    // The regression a review caught before merge: a `MediaRecorder`-based
    // capture pipeline carried its container header only in the very first
    // timesliced chunk of a recording session, and the ring's own age-based
    // eviction discarded that chunk like any other once the session ran
    // longer than the ring's own capacity — which every real capture does,
    // since a camera is opened and aimed well before the first heat.
    // `capture.ts` now forces a fresh keyframe roughly every second and
    // `mux.ts` writes a fresh container header for whatever chunks a cut
    // hands it, so this should no longer depend on chunk 0 surviving at all
    // — proven here by actually waiting past the ring's own capacity before
    // cutting anything, then asserting the resulting clip is not merely
    // *uploaded* but genuinely decodable.
    //
    // `ringMs=3000` shrinks `Camera.tsx`'s own ~10s default down to 3s for
    // this page only — a real camera never sets this. The property under
    // test (a cut long after the ring's own opening keyframe is gone) does
    // not depend on the window's actual size, only on it having rolled over
    // at least once; a real 10s wait proved the identical thing at ~4x the
    // wall-clock cost and ~4x the encoded frames, on a shard already running
    // the rest of the functional suite alongside it.
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Eviction Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(3);
    // Three heats warm up two independent `seen === null` edges before the
    // one under test — the camera's own (`timingStats`) and the display's
    // own (`heatReplay`), exactly as the first test in this file explains.
    const [camWarmUp, displayWarmUp, underTest] = heats;

    const camera = await (await browser.newContext()).newPage();
    await openCamera(camera, raceId, 'spec-camera-eviction', '&ringMs=3000');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-eviction');

    // Warm-up 1: swallowed by the camera's own `seenHeatResult` — no clip
    // yet.
    await runHeatToStart(page, camWarmUp.id);
    await finishHeat(page, camWarmUp.id);
    await camera.waitForTimeout(2000);

    // Warm-up 2: the camera now captures — this race's first clip, which is
    // exactly what the display's own fresh `heatReplay` subscription reads
    // as its opening payload and swallows in turn.
    const warmUpload = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await warmUpload;
    await display.waitForTimeout(1000);

    // Sit past the shrunk 3s ring — several keyframe cycles beyond it — before
    // cutting anything under test. This is the actual shape of the bug: not
    // "a clip cut inside the ring's own opening window," but a camera left
    // running well past it, which is every real capture.
    await camera.waitForTimeout(4500);

    const uploadResponse = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    const response = await uploadResponse;
    expect(response.status()).toBe(200);

    // Not just "an upload happened" — an upload happens whether or not the
    // file is playable, which is exactly how the original bug shipped with
    // every automated check green. The clip must actually decode.
    const video = display.getByTestId('replay-video');
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect
        .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 10000 })
        .toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA or better — real decoded frame data
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
});

test('a heat re-run plays its corrected clip; the identical clip does not replay a second time on reconnect', async ({
    browser,
    page,
}) => {
    // Closes the gap the review named: `Observation.tsx` keys a replay off
    // `{heatId, recordedAt}` (`resultsOverlay.ts`'s `observeHeatResult`,
    // proven correct at the pure-function level in `resultsOverlay.test.ts`)
    // but nothing end to end had ever actually re-run a heat while its
    // replay was live. Same heat, new `recordedAt` → the corrected clip
    // must replay; the identical pair arriving again (a reconnect finding
    // the same clip still current) must not replay a second time.
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Rerun Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(3);
    // Three heats warm up two independent `seen === null` edges before the
    // one under test — the camera's own (`timingStats`) and the display's
    // own (`heatReplay`), exactly as the first test in this file explains.
    const [camWarmUp, displayWarmUp, underTest] = heats;

    const camera = await (await browser.newContext()).newPage();
    await openCamera(camera, raceId, 'spec-camera-rerun');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-rerun');

    // Warm-up 1: swallowed by the camera's own `seenHeatResult` — no clip
    // yet.
    await runHeatToStart(page, camWarmUp.id);
    await finishHeat(page, camWarmUp.id);
    await camera.waitForTimeout(2000);

    // Warm-up 2: the camera now captures — this race's first clip, which is
    // exactly what the display's own fresh `heatReplay` subscription reads
    // as its opening payload and swallows in turn.
    const warmUpload = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await warmUpload;
    await display.waitForTimeout(1000);

    // First run of the heat under test — genuinely new to both the camera
    // and the display.
    const firstUpload = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await firstUpload;
    await expect(display.getByTestId('replay-video')).toBeVisible({ timeout: 15000 });
    const firstSrc = await display.getByTestId('replay-video').getAttribute('src');
    // Let it finish its two showings and disappear, so the re-run's own
    // clip is unambiguously a *second* appearance rather than an extension
    // of the first.
    await expect(display.getByTestId('replay-player')).toBeHidden({ timeout: 60000 });

    // Re-run the *same* heat — "Reset Heat," the operator's own way to
    // abandon a run and retry it (`prepareHeat` on an already-recorded
    // heat). Same `heatId`, a fresh `recordedAt` once it finishes again.
    const secondUpload = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 45000 },
    );
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await secondUpload;

    // The corrected clip replays — proving the key is `{heatId,
    // recordedAt}` together, not `heatId` alone (which would have read
    // this as "the same result already shown" and never played it).
    await expect(display.getByTestId('replay-video')).toBeVisible({ timeout: 15000 });
    const secondSrc = await display.getByTestId('replay-video').getAttribute('src');
    expect(secondSrc).not.toBe(firstSrc);
    await expect(display.getByTestId('replay-player')).toBeHidden({ timeout: 60000 });

    // Reconnecting now finds the identical `{heatId, recordedAt}` pair
    // still current — the `seen === null` rule must swallow it exactly as
    // it does for a genuinely first-ever clip, not replay it a third time.
    await display.reload();
    await display.waitForLoadState('networkidle');
    await display.waitForTimeout(3000);
    await expect(display.getByTestId('replay-video')).toHaveCount(0);
});
