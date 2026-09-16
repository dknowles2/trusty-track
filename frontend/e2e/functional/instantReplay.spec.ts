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

/**
 * `keepReplays` and its two retention bounds (#177 stage 2) — install-wide,
 * shared with every other spec in this run, the same `debugAndThemes.spec.ts`
 * exception this file's own header docs don't otherwise take: each caller
 * restores it afterward. Driven through the real System Settings form
 * (Appearance section) rather than a hand-built `updateInitialConfig` call —
 * the form already holds this install's full track list in its own state and
 * resends it unchanged, which is what `InitialConfigInput.tracks` being
 * required (an empty list means "delete every track", not "leave alone")
 * would otherwise make a hand-built payload responsible for getting right.
 */
async function setKeepReplays(
    page: Page,
    { on, retentionHeats }: { on: boolean; retentionHeats?: number },
): Promise<void> {
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-appearance').click();
    const checkbox = page.getByLabel('Keep replay clips');
    if (on) {
        if (!(await checkbox.isChecked())) await checkbox.check();
        // The retention box only renders while the checkbox is on — fill it
        // (or clear it, for "no bound") while it is actually on screen.
        await page.getByLabel('Keep the last').fill(retentionHeats !== undefined ? String(retentionHeats) : '');
    } else if (await checkbox.isChecked()) {
        // Clear the bound while the field is still visible, before
        // unchecking hides it — otherwise a stale number lingers in this
        // install's own saved state with nothing on screen to show it.
        await page.getByLabel('Keep the last').fill('');
        await checkbox.uncheck();
    }
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
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

    // Nothing further in this test needs the camera capturing — closing its
    // context here rather than at the test's own end stops the real
    // VideoEncoder pipeline from burning CPU on a shared CI runner for the
    // ~60s the playback assertions below can take, freeing that headroom for
    // whatever else this worker's shard is running alongside it.
    await cameraContext.close();

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
    // Nothing further needs the camera capturing — see the first test's own
    // comment on why this is closed as soon as it stops being needed.
    await camera.context().close();

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
    // Nothing further needs the camera capturing — see the first test's own
    // comment on why this is closed as soon as it stops being needed.
    await camera.context().close();

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
    // Nothing further needs the camera capturing — see the first test's own
    // comment on why this is closed as soon as it stops being needed.
    await camera.context().close();

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
    // Nothing further needs the camera capturing — see the first test's own
    // comment on why this is closed as soon as it stops being needed.
    await camera.context().close();

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

test.describe.serial('stage 2: stored retention, install-wide, so these three run serially rather than racing each other over the shared keepReplays flag (#177)', () => {
    // Confined to one worker (serial mode), with a real System Settings
    // round trip between each of the three tests and two camera uploads
    // apiece — comfortably inside the file's own 180s default alone, but
    // this group also raises its own upload waits to 90s (from the file's
    // usual 45s) for headroom under a busy CI runner, and three tests'
    // worth of that has to fit under one ceiling.
    test.describe.configure({ timeout: 300_000 });

    test('the Schedule tab offers a ▶ once Keep replay clips is on, playing a decodable clip, and it survives the next heat', async ({
        browser,
        page,
    }) => {
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay Stored Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(4);
        const [camWarmUp, displayWarmUp, underTest, afterward] = heats;

        await setKeepReplays(page, { on: true });

        try {
            const camera = await (await browser.newContext()).newPage();
            await openCamera(camera, raceId, 'spec-camera-stored');
            await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            // Two warm-ups, exactly as every other test in this file — the
            // camera's own `seen === null` edge, then the first clip a fresh
            // `heatReplay` subscription would otherwise swallow. Stage 2's own
            // storage does not depend on a display being open at all, but the
            // camera still needs to be past its own warm-up before it captures
            // anything.
            await runHeatToStart(page, camWarmUp.id);
            await finishHeat(page, camWarmUp.id);
            await camera.waitForTimeout(2000);

            const warmUpload = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, displayWarmUp.id);
            await finishHeat(page, displayWarmUp.id);
            await warmUpload;

            const uploadResponse = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, underTest.id);
            await finishHeat(page, underTest.id);
            await uploadResponse;
            await camera.context().close();

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            const replayButton = page.getByTestId(`heat-replay-btn-${underTest.id}`);
            await expect(replayButton).toBeVisible({ timeout: 15000 });

            await replayButton.click();
            const video = page.getByTestId('replay-video');
            await expect(video).toBeVisible({ timeout: 15000 });
            await expect(video).toHaveAttribute('src', /\/replay\//);
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.duration), { timeout: 10000 })
                .toBeGreaterThan(0);
            await page.keyboard.press('Escape');

            // Preparing the *next* heat is stage 1a's own purge trigger
            // (`discard_or_retain`) — with the setting on, it must be a no-op:
            // the ▶ for the heat under test survives. Finished, not just
            // armed — an armed-and-never-finished heat leaves the track's
            // one `TimerManager` RUNNING, which refuses to arm a later
            // heat (`.claude/rules/timers.md`'s #337) and would starve
            // every later test sharing this worker's own track.
            await runHeatToStart(page, afterward.id);
            await finishHeat(page, afterward.id);
            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${underTest.id}`)).toBeVisible({ timeout: 15000 });
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });

    test('no ▶ appears on the Schedule tab when Keep replay clips is off', async ({ browser, page }) => {
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay No Storage Race');
        await scheduleWithSpareHeats(page, raceId);
        const [warmUp, underTest] = await officialHeatsInOrder(page, raceId);

        const camera = await (await browser.newContext()).newPage();
        await openCamera(camera, raceId, 'spec-camera-no-storage');
        await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
        await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
            timeout: 15000,
        });

        await runHeatToStart(page, warmUp.id);
        await finishHeat(page, warmUp.id);
        await camera.waitForTimeout(2000);

        const uploadResponse = camera.waitForResponse(
            (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
            { timeout: 90000 },
        );
        await runHeatToStart(page, underTest.id);
        await finishHeat(page, underTest.id);
        await uploadResponse;
        await camera.context().close();

        // The clip exists (the camera uploaded it, and it plays on a display
        // right after the results overlay) — it is simply never persisted as a
        // `HeatReplay` row, since `keepReplays` is off, which is this
        // install's own default and so needs no setup here.
        await page.goto(`/race/${raceId}/control/schedule`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText(`Heat ${underTest.heatNumber}`)).toBeVisible();
        await expect(page.getByTestId(`heat-replay-btn-${underTest.id}`)).toHaveCount(0);
    });

    test('retention keeps only the last N heats\' clips', async ({ browser, page }) => {
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay Retention Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(4);
        const [camWarmUp, first, second, third] = heats;

        // N=1: only the most recently active heat's clip should ever survive.
        await setKeepReplays(page, { on: true, retentionHeats: 1 });

        try {
            const camera = await (await browser.newContext()).newPage();
            await openCamera(camera, raceId, 'spec-camera-retention');
            await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            await runHeatToStart(page, camWarmUp.id);
            await finishHeat(page, camWarmUp.id);
            await camera.waitForTimeout(2000);

            const firstUpload = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, first.id);
            await finishHeat(page, first.id);
            await firstUpload;

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${first.id}`)).toBeVisible({ timeout: 15000 });

            const secondUpload = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, second.id);
            await finishHeat(page, second.id);
            await secondUpload;
            await camera.context().close();

            // N=1 purged the first heat's clip the moment the second's landed.
            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${second.id}`)).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId(`heat-replay-btn-${first.id}`)).toHaveCount(0);

            // Mutation-test the bound itself: raise it, run a third heat, and
            // confirm the second heat's clip — which N=1 would have purged the
            // identical way — now survives.
            await setKeepReplays(page, { on: true, retentionHeats: 1000 });
            const camera2 = await (await browser.newContext()).newPage();
            await openCamera(camera2, raceId, 'spec-camera-retention-2');
            await camera2.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera2.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });
            const thirdUpload = camera2.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, third.id);
            await finishHeat(page, third.id);
            await thirdUpload;
            await camera2.context().close();

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${third.id}`)).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId(`heat-replay-btn-${second.id}`)).toBeVisible({ timeout: 15000 });
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });
});

test.describe.serial('stage 3: intermission highlights, install-wide via keepReplays so these run serially (#177)', () => {
    // Two camera uploads, two displays, and a Race Control round trip — the
    // same headroom the stage 2 block above gives itself for the same
    // reason.
    test.describe.configure({ timeout: 300_000 });

    test('a highlights break plays the fastest heat first, on every display including one with replays off, and clears on End now', async ({
        browser,
        page,
    }) => {
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay Highlights Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(4);
        const [camWarmUp, first, second, spare] = heats;

        await setKeepReplays(page, { on: true });

        try {
            const camera = await (await browser.newContext()).newPage();
            await openCamera(camera, raceId, 'spec-camera-highlights');
            await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            await runHeatToStart(page, camWarmUp.id);
            await finishHeat(page, camWarmUp.id);
            await camera.waitForTimeout(2000);

            const firstUpload = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, first.id);
            await finishHeat(page, first.id);
            await firstUpload;

            const secondUpload = camera.waitForResponse(
                (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
                { timeout: 90000 },
            );
            await runHeatToStart(page, second.id);
            await finishHeat(page, second.id);
            await secondUpload;
            await camera.context().close();

            // The fake timer's own results are random (3.0-4.0s) — read the
            // two heats' winning times back rather than assuming which one
            // is faster, so the "fastest first" assertion below is honest
            // regardless of the draw.
            const recorded = await officialHeatsInOrder(page, raceId);
            const winner = (heatId: number): { heatNumber: number; time: number } => {
                const heat = recorded.find((h) => h.id === heatId);
                if (!heat) throw new Error(`heat ${heatId} not found`);
                const lane = heat.lanes.find((l) => l.place === 1);
                if (!lane || lane.time == null) throw new Error(`heat ${heatId} has no timed winner`);
                return { heatNumber: heat.heatNumber, time: lane.time };
            };
            const firstWinner = winner(first.id);
            const secondWinner = winner(second.id);
            const fastestHeatNumber =
                firstWinner.time <= secondWinner.time ? firstWinner.heatNumber : secondWinner.heatNumber;

            // Two displays: one with replays on (the default), one with it
            // explicitly off — highlights are the operator's own choice for
            // the break, not the ordinary after-heat replay that setting
            // controls (`.claude/rules/displays.md`'s "Intermission
            // highlights"), so both must show the reel.
            const displayOn = await (await browser.newContext()).newPage();
            await openObservation(displayOn, raceId, 'spec-display-highlights-on');
            const displayOff = await (await browser.newContext()).newPage();
            await openObservation(displayOff, raceId, 'spec-display-highlights-off');
            await gql(
                page,
                `mutation IRAssignHighlightsOff($displayId: String!) {
                    assignDisplay(displayId: $displayId, view: STANDINGS, replays: false) { displayId }
                }`,
                { displayId: 'spec-display-highlights-off' },
            );

            await page.goto(`/race/${raceId}/control`);
            await page.waitForLoadState('networkidle');
            await page.getByRole('button', { name: 'Race', exact: true }).click();
            const toggle = page.getByTestId('intermission-toggle');
            await expect(toggle).toBeVisible({ timeout: 15000 });
            await toggle.click();
            const popover = page.getByTestId('intermission-popover');
            const highlightsCheckbox = popover.getByTestId('intermission-highlights-checkbox');
            await expect(highlightsCheckbox).toBeVisible({ timeout: 15000 });
            await expect(highlightsCheckbox).toBeChecked();
            await popover.getByTestId('intermission-preset-300').click();

            for (const display of [displayOn, displayOff]) {
                const video = display.getByTestId('replay-video');
                await expect(video).toBeVisible({ timeout: 15000 });
                await expect(video).toHaveAttribute('src', /\/replay\//);
                await expect(display.getByTestId('intermission-highlight-caption')).toContainText(
                    `Heat ${fastestHeatNumber}`,
                );
            }

            await gql(page, `mutation IREndBreak($raceId: Int!) { endIntermission(raceId: $raceId) { id } }`, {
                raceId,
            });

            for (const display of [displayOn, displayOff]) {
                await expect(display.getByTestId('replay-video')).toHaveCount(0, { timeout: 15000 });
            }

            // Finish the round's last heat so the track is not left with an
            // armed-and-never-finished heat for whatever runs after this
            // (`.claude/rules/timers.md`'s #337).
            await runHeatToStart(page, spare.id);
            await finishHeat(page, spare.id);
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });
});
