/**
 * Instant replay end to end (#177 stage 1b, extended by stages 2, 3 and 4):
 * a camera captures through `FakeCamera` (`?fake=1`), uploads to
 * `POST /replay/`, and a display with `replays` on plays the clip back
 * after its own results overlay. Stage 4 adds finish-frame markers, the
 * slow-motion window and multi-camera ordering — its own tests are the
 * standalone "results-flow overlay shows finish-frame markers" test below
 * and the last two tests inside the `describe.serial` block, which need a
 * *stored* clip (Keep replay clips on) to open the ▶ modal from the
 * Schedule tab.
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
 *
 * **Every extra `browser.newContext()` this file opens gets an explicit
 * `.close()` before its test returns — cameras always did; displays now
 * do too (#1205).** Playwright's own `page`/`context` fixtures are
 * test-scoped and close themselves; a context opened by hand inside a test
 * body is not, and `browser` itself is worker-scoped, so a context nobody
 * closes lives on into whichever test this worker runs next. This file's
 * own twelve tests used to be spread across up to four workers, each
 * running only a few of them, interleaved with dozens of unrelated, light
 * specs — so a leaked display context or two rarely accumulated far
 * before Playwright recycled the worker. Now that the whole file runs on
 * one worker's single, continuous browser session
 * (`playwright.config.ts`'s `replay` project), every leaked context from
 * every earlier test in the file is still open — a live WebSocket
 * subscription, a rendering `<video>` — when a later test starts, and
 * ten of them (every `display`/`displayOn`/`displayOff`/`ceremonyDisplay`/
 * `laterDisplay` this file ever opened, across six tests, none of them
 * closed) reliably wedged whichever test happened to run last: not the
 * *same* test each time, which is what pointed at cumulative resource
 * exhaustion rather than a bug in any one test's own logic. Reproduced
 * directly — the last test in the file hung for its own describe block's
 * full 600s ceiling in three separate runs, and running the same tests
 * without whatever ran before them passed in seconds every time.
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, gql, readHeats, seedRace, type Heat } from './support';

// Raised from 180s/45s-per-upload to 300s/90s (#177 stage 4 review) once
// this file's own camera-heavy test count grew from four to seven — the
// same "headroom under a busy CI runner" reasoning the `describe.serial`
// block below already gives its own 90s upload waits, now applied to the
// file's top-level tests too. A CI run reproduced this concretely: with
// stage 4's tests added, `a heat re-run plays its corrected clip`
// (unmodified, pre-existing) hit its old 45s `waitForResponse` ceiling
// twice under shared-runner contention, while every other job on the same
// PR passed — evidence of headroom, not of a logic break in that test.
test.setTimeout(300_000);

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
 * Waits for one camera's clip to actually exist server-side for the given
 * heat's *current* run — call this any time after `finishHeat`, not before.
 *
 * Replaces `camera.waitForResponse` watching the upload's own `POST
 * /replay/` (#1205). That wait sat on the camera page's own network
 * listener for up to 90s, which is a listener on the Vite dev proxy every
 * other spec's clicks and GraphQL calls share on this shard — under CI
 * contention the proxy itself started dropping connections
 * (`ECONNRESET`/`EPIPE`) while a slow WebCodecs encode-and-upload held that
 * wait open, and unrelated specs on other workers failed on ordinary clicks
 * and GraphQL posts while it did. `gql()` (used here, as it already is for
 * every other piece of setup in this file) talks straight to the backend
 * — it never touches the proxy at all — so polling `heatReplay(raceId)`
 * through it adds no load to the one resource every worker on this shard
 * was contending for. The assertion strength is the same: the clip must
 * actually be in the server's live replay store, keyed on the exact
 * `(heatId, recordedAt)` pair this run just produced — not merely "some
 * earlier clip from this camera exists," which a bare `cameraId` check
 * would have let a stale warm-up (or, for a re-run, the *previous* run's)
 * clip satisfy.
 *
 * `heat.recordedAt` and the camera's own clip are read in the same poll
 * rather than the heat's `recordedAt` being fetched once up front: a fresh
 * `fakeTimerFinish` GraphQL round trip completing does not guarantee a
 * *separate* request immediately afterward already sees the committed
 * result (`TimerManager` writes through its own session outside the
 * request lifecycle — `.claude/rules/timers.md`'s "`TimerManager` writes to
 * the DB via its own `SessionLocal()`, outside the request lifecycle").
 * Measured directly: a single up-front read threw "heat N has not been
 * recorded yet" on six of twelve tests in one run, immediately after
 * `finishHeat` had already resolved. Folding both reads into the one poll
 * tolerates that gap the same way the 90s ceiling already tolerates a slow
 * encode, rather than treating a heat not yet visible as a hard failure.
 *
 * `previousRecordedAt`, when given, excludes a `recordedAt` this camera
 * already satisfied — the one case where the *same* heat is waited on
 * twice (a re-run): without it, the second wait would be satisfied
 * instantly by the first run's own clip, never actually waiting for the
 * correction to land. Returns the `recordedAt` it matched, so a caller
 * re-running the same heat can pass it back in as the next call's
 * `previousRecordedAt`.
 */
async function waitForClipUpload(
    page: Page,
    raceId: number,
    heatId: number,
    cameraId: string,
    previousRecordedAt: string | null = null,
): Promise<string> {
    let matchedRecordedAt: string | null = null;
    await expect
        .poll(
            async () => {
                const data = await gql<{
                    race: { heats: { id: number; recordedAt: string | null }[] };
                    heatReplay: { heatId: number; recordedAt: string; clips: { cameraId: string }[] } | null;
                }>(
                    page,
                    `query IRPollReplay($raceId: Int!) {
                        race(raceId: $raceId) { heats { id recordedAt } }
                        heatReplay(raceId: $raceId) { heatId recordedAt clips { cameraId } }
                    }`,
                    { raceId },
                );
                const heat = data.race.heats.find((h) => h.id === heatId);
                if (!heat || heat.recordedAt === null || heat.recordedAt === previousRecordedAt) {
                    return false;
                }
                const current = data.heatReplay;
                const matched =
                    current !== null &&
                    current.heatId === heatId &&
                    current.recordedAt === heat.recordedAt &&
                    current.clips.some((c) => c.cameraId === cameraId);
                if (matched) matchedRecordedAt = heat.recordedAt;
                return matched;
            },
            { timeout: 90000, message: `no clip from ${cameraId} landed for heat ${heatId}` },
        )
        .toBe(true);
    // `expect.poll` only returns once its predicate is `true`, which is the
    // one path `matchedRecordedAt` is ever left unset by — this satisfies
    // the type checker without weakening the assertion above.
    return matchedRecordedAt ?? previousRecordedAt ?? '';
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
    await finishHeat(page, replayWarmUp.id);
    await waitForClipUpload(page, raceId, replayWarmUp.id, 'spec-camera-playback');
    await display.waitForTimeout(2000);

    // The heat under test.
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-playback');
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

    // Finish the spare heat so the track is not left with an
    // armed-and-never-finished heat for whatever runs after this
    // (`.claude/rules/timers.md`'s #337) — this file now runs its own
    // twelve tests one after another on one worker's single track (#1205),
    // so a heat left RUNNING here is no longer a rare adjacency, it is the
    // very next test, every time. Confirmed the hard way: without this, the
    // next test's own `prepareHeat` never gets a chance to run and every
    // heat after this one in the file goes unrecorded.
    await finishHeat(page, afterward.id);
    // See this file's own header docs — every extra context gets closed now.
    await display.context().close();
    await laterDisplay.context().close();
});

test('the results-flow overlay shows finish-frame markers, and they are not clickable (#177 stage 4)', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay Overlay Markers Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(3);
    const [timingWarmUp, replayWarmUp, underTest] = heats;

    const cameraContext = await browser.newContext();
    const camera = await cameraContext.newPage();
    await openCamera(camera, raceId, 'spec-camera-overlay-marks');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-overlay-marks');

    await runHeatToStart(page, timingWarmUp.id);
    await finishHeat(page, timingWarmUp.id);
    await camera.waitForTimeout(2000);

    await runHeatToStart(page, replayWarmUp.id);
    await finishHeat(page, replayWarmUp.id);
    await waitForClipUpload(page, raceId, replayWarmUp.id, 'spec-camera-overlay-marks');
    await display.waitForTimeout(2000);

    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-overlay-marks');
    await cameraContext.close();

    const video = display.getByTestId('replay-video');
    await expect(video).toBeVisible({ timeout: 15000 });

    // The timeline strip renders — one tick per lane that actually
    // finished inside the clip — but every tick is `disabled`: the
    // auto-playing overlay is not something anybody is meant to touch
    // (`ReplayPlayer`'s own `controls` flag is what the modal below sets
    // and this overlay never does). `disabled` is the assertion itself —
    // a disabled `<button>` cannot fire a click handler at all, by HTML's
    // own semantics, so there is nothing further to prove by clicking one;
    // the clip's own short, twice-through playback (`showings`) makes "is
    // it still playing a moment later" an inherently racy thing to assert
    // on instead.
    const marks = display.locator('[data-testid^="replay-finish-mark-"]');
    await expect(marks.first()).toBeVisible({ timeout: 15000 });
    await expect(marks.first()).toBeDisabled();
    await display.context().close();
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
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-off');
    // Nothing further needs the camera capturing — see the first test's own
    // comment on why this is closed as soon as it stops being needed.
    await camera.context().close();

    // The clip exists (the camera uploaded it) — this display simply never
    // acts on it.
    await display.waitForTimeout(3000);
    await expect(display.getByTestId('replay-video')).toHaveCount(0);
    await display.context().close();
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
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-reconnect');
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
    await display.context().close();
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
    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-eviction');
    await display.waitForTimeout(1000);

    // Sit past the shrunk 3s ring — several keyframe cycles beyond it — before
    // cutting anything under test. This is the actual shape of the bug: not
    // "a clip cut inside the ring's own opening window," but a camera left
    // running well past it, which is every real capture.
    await camera.waitForTimeout(4500);

    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-eviction');
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
    await display.context().close();
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
    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-rerun');
    await display.waitForTimeout(1000);

    // First run of the heat under test — genuinely new to both the camera
    // and the display.
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    const firstRecordedAt = await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-rerun');
    await expect(display.getByTestId('replay-video')).toBeVisible({ timeout: 15000 });
    const firstSrc = await display.getByTestId('replay-video').getAttribute('src');
    // Let it finish its two showings and disappear, so the re-run's own
    // clip is unambiguously a *second* appearance rather than an extension
    // of the first.
    await expect(display.getByTestId('replay-player')).toBeHidden({ timeout: 60000 });

    // Re-run the *same* heat — "Reset Heat," the operator's own way to
    // abandon a run and retry it (`prepareHeat` on an already-recorded
    // heat). Same `heatId`, a fresh `recordedAt` once it finishes again —
    // passing the first run's own `recordedAt` as `previousRecordedAt` is
    // what tells this second wait apart from the first, rather than being
    // satisfied instantly by the clip that already landed above.
    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-rerun', firstRecordedAt);
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
    await display.context().close();
});

/**
 * WebKit has never shipped `MediaStreamTrackProcessor` (#1294) —
 * `capture.ts`'s `canvasFrameSource` is the fallback frame source that
 * lights the camera page up there anyway, and these two tests are what
 * actually exercises it, since no CI runner is an iPhone. Two different
 * ways of getting there, both asserted the same way as the file's very
 * first test (a decodable clip, playing on a display) plus one thing that
 * test doesn't check: the gate must show no refusal message while it does.
 *
 * **`?noProcessor=1`** forces `startCapture`'s own choice, in a Chromium
 * context that genuinely does carry `MediaStreamTrackProcessor` — this
 * proves the fallback's own frame-production and encode path work, but
 * proves nothing about the gate, since the processor is still there for
 * `browserSupport.ts` to see.
 *
 * **Deleting `MediaStreamTrackProcessor` via `addInitScript`** proves the
 * other half: with the API genuinely absent before any page script runs,
 * `capture.ts`'s own feature detection (not the query-string hook) picks
 * the fallback on its own, and `browserSupport.ts`'s gate — which no longer
 * requires the processor at all — must let the page through rather than
 * refusing.
 *
 * Neither test can prove this works on an actual iPhone: both run inside
 * Chromium, and what changes between them and the file's other tests is
 * only which frame source `capture.ts` picks, never WebKit's own
 * (unexercised, here) implementation of `new VideoFrame(canvas, {...})`.
 */
test('a camera captures through the canvas fallback when ?noProcessor=1 forces it, and a display still plays the clip (#1294)', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay WebKit Fallback Forced Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(3);
    // Two warm-ups, exactly as the file's very first test — the camera's
    // own `timingStats`-keyed `seen` state (first), then the race's first
    // clip, which is exactly what a *fresh* `heatReplay` subscription's own
    // opening payload would be — needed so the display's own `seen === null`
    // rule doesn't swallow the heat actually under test as history too.
    const [camWarmUp, displayWarmUp, underTest] = heats;

    const cameraContext = await browser.newContext();
    const camera = await cameraContext.newPage();
    await openCamera(camera, raceId, 'spec-camera-fallback-forced', '&noProcessor=1');
    // The gate must not refuse — MediaStreamTrackProcessor is still present
    // in this Chromium context; only capture.ts's own choice of frame
    // source is forced by the query string.
    await expect(camera.getByText(/Use Chrome, Edge or Safari/)).toHaveCount(0);
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-fallback-forced');

    await runHeatToStart(page, camWarmUp.id);
    await finishHeat(page, camWarmUp.id);
    await camera.waitForTimeout(2000);

    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-fallback-forced');
    await display.waitForTimeout(2000);

    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-fallback-forced');
    await cameraContext.close();

    // Not just "an upload happened" — the clip must actually decode, the
    // same strength the file's own post-eviction test already holds the
    // processor path to.
    const video = display.getByTestId('replay-video');
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect(video).toHaveAttribute('src', /\/replay\//);
    await expect
        .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 10000 })
        .toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA or better — real decoded frame data
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
    await display.context().close();
});

test('a camera captures through the canvas fallback when MediaStreamTrackProcessor is genuinely absent, and the gate shows no refusal (#1294)', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Instant Replay WebKit Fallback Absent Race');
    await scheduleWithSpareHeats(page, raceId, 3);
    const heats = await officialHeatsInOrder(page, raceId);
    expect(heats.length).toBeGreaterThanOrEqual(3);
    // Two warm-ups — see the previous test's own comment for why.
    const [camWarmUp, displayWarmUp, underTest] = heats;

    const cameraContext = await browser.newContext();
    // Simulates WebKit's own absence of the insertable-streams API — set
    // before any page script runs, so `capture.ts`'s own feature detection
    // (not the `?noProcessor=1` hook the test above uses) sees exactly what
    // an iPhone's own browser would.
    await cameraContext.addInitScript(() => {
        delete (window as unknown as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor;
    });
    const camera = await cameraContext.newPage();

    // Prove the gate itself, in a real (non-fake) load. `?fake=1` bypasses
    // both browser gates outright by design (`Camera.tsx`'s `!fake &&`
    // guards) — every other assertion in this test needs that bypass to
    // drive a capture with no real device, but proving the *gate itself*
    // does not refuse a genuinely-absent processor needs the opposite: a
    // load that actually reaches `browserSupport.ts`'s check. This is the
    // #1294 fix's own headline behaviour, checked directly rather than only
    // inferred from a clip landing below.
    await camera.goto(`/race/${raceId}/camera?displayId=spec-camera-fallback-absent-gate`);
    await camera.waitForLoadState('networkidle');
    await expect(camera.getByText(/Use Chrome, Edge or Safari/)).toHaveCount(0);
    await expect(camera.getByText(/Instant replay needs a newer iOS/)).toHaveCount(0);

    // The rest of this test proves the fallback itself actually captures
    // and uploads, through the same `?fake=1` flow every other test in this
    // file uses — no CI runner has a real camera for the check above to
    // drive a genuine `getUserMedia` capture through.
    await openCamera(camera, raceId, 'spec-camera-fallback-absent');
    await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
    await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
        timeout: 15000,
    });

    const display = await (await browser.newContext()).newPage();
    await openObservation(display, raceId, 'spec-display-fallback-absent');

    await runHeatToStart(page, camWarmUp.id);
    await finishHeat(page, camWarmUp.id);
    await camera.waitForTimeout(2000);

    await runHeatToStart(page, displayWarmUp.id);
    await finishHeat(page, displayWarmUp.id);
    await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-fallback-absent');
    await display.waitForTimeout(2000);

    await runHeatToStart(page, underTest.id);
    await finishHeat(page, underTest.id);
    await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-fallback-absent');
    await cameraContext.close();

    const video = display.getByTestId('replay-video');
    await expect(video).toBeVisible({ timeout: 15000 });
    await expect(video).toHaveAttribute('src', /\/replay\//);
    await expect
        .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 10000 })
        .toBeGreaterThanOrEqual(2);
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
    await display.context().close();
});

test.describe.serial('stored retention and intermission highlights, install-wide, so these four run serially rather than racing each other over the shared keepReplays flag (#177 stages 2 and 3)', () => {
    // Confined to one worker (serial mode), with a real System Settings
    // round trip between most of the four tests and two camera uploads
    // apiece — comfortably inside the file's own 180s default alone, but
    // this group also raises its own upload waits to 90s (from the file's
    // usual 45s) for headroom under a busy CI runner, and four tests'
    // worth of that has to fit under one ceiling.
    //
    // Stage 3's own "highlights" test used to sit in a second, sibling
    // `describe.serial` block. Each block serialized *within* itself but
    // not against the other, and `playwright.config.ts`'s `fullyParallel:
    // true` let the two run concurrently in different workers against the
    // same backend whenever the whole file runs together — reproduced
    // directly: "no ▶ appears... when Keep replay clips is off" (this
    // block's own second test) failed because the highlights test had
    // flipped the install-wide flag back on while that assertion's heat
    // was still in flight. CI's own sharding happened to keep the two
    // blocks apart, which was incidental isolation, not a fix — a
    // rebalanced shard could have started flaking it at any time. One
    // block, one worker, is what actually serializes them against each
    // other.
    //
    // Was raised to 600s from an original 400s once #177 stage 4 added two
    // more camera-heavy tests to this block, back when this whole file still
    // shared the `chromium` worker pool: six tests' worth of real WebCodecs
    // encoding on this block's own worker, contending with whatever else of
    // the file was running on the *other* workers at the same time. That
    // contention is gone twice over since: #1205 put the whole file on one
    // single, continuous `replay` worker, so nothing in this file ever runs
    // concurrently with another part of it any more; and #1212 orders `replay`
    // strictly after `chromium` in CI (`ci.yml`'s `e2e` job), so nothing
    // outside this file is driving the shared Vite dev server while this
    // block runs either. 600s was sized for a contention model that no
    // longer applies — but lowering it is only a mitigation (a stall still
    // costs whatever the new ceiling is, once, before a retry clears it), and
    // the real fix is the ordering above, so this stays evidence-driven
    // rather than guessed down.
    //
    // Measured against two green CI runs on this tree (35303267590,
    // 35309685831), from the `[replay]` list-reporter timestamps: every test
    // in this block completes in 12–29s, the slowest being "retention keeps
    // only the last N heats' clips" (28.3s and 29.0s) — the one test here
    // making three sequential `waitForClipUpload` calls, each independently
    // capped at 90s. 300_000 keeps better than 10x margin over that observed
    // max (300s / 29s ≈ 10.3x, comfortably past the 3x floor) while still
    // covering that same test's three 90s upload-wait ceilings stacked to
    // their full extent (270s) plus headroom for its surrounding 15s
    // assertions, in the pathological case where every one of them is
    // genuinely just slow rather than stalled outright. A real stall — the
    // kind #1212 found, silent for the entire ceiling with an `ECONNRESET` in
    // the Vite log — now surfaces in half the time instead of ten minutes.
    test.describe.configure({ timeout: 300_000 });

    test.afterAll(async ({ browser }) => {
        // Belt and braces beyond each test's own `finally`: whichever test
        // ran last leaves the install-wide flag exactly as every other spec
        // in the suite assumes it — off — even if a test above threw before
        // reaching its own restore.
        const page = await (await browser.newContext()).newPage();
        await ensureConfigured(page);
        await setKeepReplays(page, { on: false });
        await page.context().close();
    });

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

            await runHeatToStart(page, displayWarmUp.id);
            await finishHeat(page, displayWarmUp.id);
            await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-stored');

            await runHeatToStart(page, underTest.id);
            await finishHeat(page, underTest.id);
            await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-stored');
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

        await runHeatToStart(page, underTest.id);
        await finishHeat(page, underTest.id);
        await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-no-storage');
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

            await runHeatToStart(page, first.id);
            await finishHeat(page, first.id);
            await waitForClipUpload(page, raceId, first.id, 'spec-camera-retention');

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${first.id}`)).toBeVisible({ timeout: 15000 });

            await runHeatToStart(page, second.id);
            await finishHeat(page, second.id);
            await waitForClipUpload(page, raceId, second.id, 'spec-camera-retention');
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
            await runHeatToStart(page, third.id);
            await finishHeat(page, third.id);
            await waitForClipUpload(page, raceId, third.id, 'spec-camera-retention-2');
            await camera2.context().close();

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            await expect(page.getByTestId(`heat-replay-btn-${third.id}`)).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId(`heat-replay-btn-${second.id}`)).toBeVisible({ timeout: 15000 });
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });

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

            await runHeatToStart(page, first.id);
            await finishHeat(page, first.id);
            await waitForClipUpload(page, raceId, first.id, 'spec-camera-highlights');

            await runHeatToStart(page, second.id);
            await finishHeat(page, second.id);
            await waitForClipUpload(page, raceId, second.id, 'spec-camera-highlights');
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

            // Three displays: one with replays on (the default), one with it
            // explicitly off — highlights are the operator's own choice for
            // the break, not the ordinary after-heat replay that setting
            // controls (`.claude/rules/displays.md`'s "Intermission
            // highlights"), so both must show the reel — and one on the
            // awards-ceremony route, which (#592, #1072) takes a break over
            // exactly like every other display and must show the identical
            // reel rather than falling back to its own next-up preview.
            const displayOn = await (await browser.newContext()).newPage();
            await openObservation(displayOn, raceId, 'spec-display-highlights-on');
            const displayOff = await (await browser.newContext()).newPage();
            await openObservation(displayOff, raceId, 'spec-display-highlights-off');
            const ceremonyDisplay = await (await browser.newContext()).newPage();
            await ceremonyDisplay.goto(`/race/${raceId}/awards/present?displayId=spec-display-highlights-ceremony`);
            await ceremonyDisplay.waitForLoadState('networkidle');
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

            for (const display of [displayOn, displayOff, ceremonyDisplay]) {
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

            for (const display of [displayOn, displayOff, ceremonyDisplay]) {
                await expect(display.getByTestId('replay-video')).toHaveCount(0, { timeout: 15000 });
            }
            // See this file's own header docs — every extra context gets
            // closed now, three of them here rather than one.
            for (const display of [displayOn, displayOff, ceremonyDisplay]) {
                await display.context().close();
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

    test('the ▶ modal shows a finish-frame marker per lane; clicking one freezes the clip, and "." steps a frame (#177 stage 4)', async ({
        browser,
        page,
    }) => {
        await ensureConfigured(page);
        const { raceId, trackId, laneCount } = await seedRace(page, 'Instant Replay Finish Frames Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(4);
        const [camWarmUp, displayWarmUp, underTest, afterward] = heats;

        await setKeepReplays(page, { on: true });

        try {
            const camera = await (await browser.newContext()).newPage();
            await openCamera(camera, raceId, 'spec-camera-finish-frames');
            await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            await runHeatToStart(page, camWarmUp.id);
            await finishHeat(page, camWarmUp.id);
            await camera.waitForTimeout(2000);

            await runHeatToStart(page, displayWarmUp.id);
            await finishHeat(page, displayWarmUp.id);
            await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-finish-frames');

            await runHeatToStart(page, underTest.id);
            await finishHeat(page, underTest.id);
            await waitForClipUpload(page, raceId, underTest.id, 'spec-camera-finish-frames');
            await camera.context().close();

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            const replayButton = page.getByTestId(`heat-replay-btn-${underTest.id}`);
            await expect(replayButton).toBeVisible({ timeout: 15000 });
            await replayButton.click();

            const dialog = page.getByRole('dialog');
            const video = dialog.getByTestId('replay-video');
            await expect(video).toBeVisible({ timeout: 15000 });
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.duration), { timeout: 10000 })
                .toBeGreaterThan(0);

            // One tick per lane the fake timer actually finished — the whole
            // point of #177 stage 4's wait-for-the-post-roll fix (see
            // `.claude/rules/displays.md`) is that every lane's own finish
            // now lands inside the produced clip's own duration.
            const marks = dialog.locator('[data-testid^="replay-finish-mark-"]');
            await expect(marks).toHaveCount(laneCount, { timeout: 15000 });

            // Sorted left to right by when each lane crosses — `.first()` is
            // the fastest lane, whichever one the fake timer happened to make
            // it.
            const fastest = marks.first();
            const ariaLabel = await fastest.getAttribute('aria-label');
            expect(ariaLabel).toMatch(/^Seek to L\d+ /);

            await fastest.click();
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused), { timeout: 5000 })
                .toBe(true);
            await expect(dialog.getByTestId('replay-finish-caption')).toBeVisible({ timeout: 5000 });

            const frozenAt = await video.evaluate((el: HTMLVideoElement) => el.currentTime);

            // "." steps one frame (1/30s) forward while paused — the keydown
            // bubbles from whatever the click just focused up to the
            // player's own frame, which is the element actually listening.
            await page.keyboard.press('.');
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 5000 })
                .toBeGreaterThan(frozenAt);
            const steppedTo = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
            expect(steppedTo - frozenAt).toBeCloseTo(1 / 30, 2);

            await page.keyboard.press('Escape');

            // Finish the spare heat so the track is not left with an
            // armed-and-never-finished heat for whatever runs after this.
            await runHeatToStart(page, afterward.id);
            await finishHeat(page, afterward.id);
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });

    test("two cameras' clips list in the operator's own order in the ▶ modal's camera picker (#177 stage 4)", async ({
        browser,
        page,
    }) => {
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay Camera Order Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(4);
        const [warmUp, displayWarmUp, underTest, afterward] = heats;

        await setKeepReplays(page, { on: true });

        try {
            const cameraA = await (await browser.newContext()).newPage();
            await openCamera(cameraA, raceId, 'spec-camera-order-a');
            await cameraA.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(cameraA.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            const cameraB = await (await browser.newContext()).newPage();
            await openCamera(cameraB, raceId, 'spec-camera-order-b');
            await cameraB.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(cameraB.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            // Both cameras are registered now — order them before either
            // uploads a single clip, so this is purely a test of
            // `setCameraOrder`/`_order_replay_clips`, not of upload timing.
            await gql(
                page,
                `mutation IRSetOrderB($displayId: String!, $order: Int!) {
                    setCameraOrder(displayId: $displayId, order: $order) { displayId cameraOrder }
                }`,
                { displayId: 'spec-camera-order-b', order: 0 },
            );
            await gql(
                page,
                `mutation IRSetOrderA($displayId: String!, $order: Int!) {
                    setCameraOrder(displayId: $displayId, order: $order) { displayId cameraOrder }
                }`,
                { displayId: 'spec-camera-order-a', order: 1 },
            );

            await runHeatToStart(page, warmUp.id);
            await finishHeat(page, warmUp.id);
            await cameraA.waitForTimeout(2000);

            await runHeatToStart(page, displayWarmUp.id);
            await finishHeat(page, displayWarmUp.id);
            await Promise.all([
                waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-order-a'),
                waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-order-b'),
            ]);

            await runHeatToStart(page, underTest.id);
            await finishHeat(page, underTest.id);
            await Promise.all([
                waitForClipUpload(page, raceId, underTest.id, 'spec-camera-order-a'),
                waitForClipUpload(page, raceId, underTest.id, 'spec-camera-order-b'),
            ]);
            await cameraA.context().close();
            await cameraB.context().close();

            await page.goto(`/race/${raceId}/control/schedule`);
            await page.waitForLoadState('networkidle');
            const replayButton = page.getByTestId(`heat-replay-btn-${underTest.id}`);
            await expect(replayButton).toBeVisible({ timeout: 15000 });
            await replayButton.click();

            const picker = page.getByTestId('heat-replay-camera-picker');
            await expect(picker).toBeVisible({ timeout: 15000 });
            const pickerButtons = picker.locator('button');
            await expect(pickerButtons).toHaveCount(2);
            await expect(pickerButtons.nth(0)).toHaveText('spec-camera-order-b');
            await expect(pickerButtons.nth(1)).toHaveText('spec-camera-order-a');
            await page.keyboard.press('Escape');

            await runHeatToStart(page, afterward.id);
            await finishHeat(page, afterward.id);
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });

    test('pressing Space to resume a frozen earlier-heat replay does not also advance the active heat (#177 stage 4, PR review)', async ({
        browser,
        page,
    }) => {
        // A PR review reproduced this live: `HeatReplayModal` portals to
        // `document.body` (`Modal.tsx`), so its own Space-to-resume keydown
        // used to bubble past this component's place in the React tree and
        // reach `RaceExecution.tsx`'s global `window` shortcut listener too
        // — pressing Space to resume a *frozen, earlier* heat's replay
        // (opened from Previous Heats, not the Schedule tab) silently
        // advanced the *active*, just-recorded heat underneath the modal.
        // Fixed two ways: `ReplayPlayer`'s own `handleKeyDown` now calls
        // `stopPropagation()` on every key it handles, and `RaceExecution`
        // gets a `replayModalOpen` prop (`RaceControl.tsx`'s
        // `replayModalHeatId !== null`) folded into its own `modalOpen`
        // shortcut gate as a second, independent guard.
        await ensureConfigured(page);
        const { raceId, trackId } = await seedRace(page, 'Instant Replay Space Collision Race');
        await scheduleWithSpareHeats(page, raceId, 3);
        const heats = await officialHeatsInOrder(page, raceId);
        expect(heats.length).toBeGreaterThanOrEqual(5);
        const [camWarmUp, displayWarmUp, target, activeHeat, spareNext] = heats;

        await setKeepReplays(page, { on: true });

        try {
            const camera = await (await browser.newContext()).newPage();
            await openCamera(camera, raceId, 'spec-camera-space-collision');
            await camera.getByLabel('Which track this camera listens to').selectOption(String(trackId));
            await expect(camera.getByTestId('camera-status-line')).toContainText('Listening to', {
                timeout: 15000,
            });

            await runHeatToStart(page, camWarmUp.id);
            await finishHeat(page, camWarmUp.id);
            await camera.waitForTimeout(2000);

            await runHeatToStart(page, displayWarmUp.id);
            await finishHeat(page, displayWarmUp.id);
            await waitForClipUpload(page, raceId, displayWarmUp.id, 'spec-camera-space-collision');

            // `target` is the heat whose replay gets frozen and resumed —
            // it has to be recorded (and its clip stored) *before* Race
            // Control's Race tab is ever opened, so the tab's own
            // first-render pin (`RaceControl.tsx`'s "the first heat still
            // to be run") lands on `activeHeat`, not on `target`.
            await runHeatToStart(page, target.id);
            await finishHeat(page, target.id);
            await waitForClipUpload(page, raceId, target.id, 'spec-camera-space-collision');
            await camera.context().close();

            await page.goto(`/race/${raceId}/control/race`);
            await page.waitForLoadState('networkidle');
            await expect(
                page.getByRole('heading', { level: 2, name: `Heat ${activeHeat.heatNumber}` }),
            ).toBeVisible({ timeout: 15000 });

            // Record the pinned heat while the page stays open — no
            // reload. The live `raceStateChanged`/`heatSession`
            // subscriptions catch the page up, and `RaceControl.tsx`'s own
            // pin (#130) keeps the screen on `activeHeat` rather than
            // sliding forward to `spareNext` the instant it is recorded —
            // exactly the "just recorded, haven't clicked Next Heat yet"
            // state the review's own reproduction needs.
            await runHeatToStart(page, activeHeat.id);
            await finishHeat(page, activeHeat.id);
            await expect(page.getByTestId('heat-phase-badge')).toContainText('Recorded', {
                timeout: 15000,
            });
            await expect(page.getByTestId('next-heat-button')).toBeEnabled({ timeout: 15000 });

            // Open the *earlier* heat's replay from Previous Heats — the
            // review's own reproduction path, not the Schedule tab's ▶.
            const replayButton = page.getByTestId(`heat-replay-btn-${target.id}`);
            await expect(replayButton).toBeVisible({ timeout: 15000 });
            await replayButton.click();

            const dialog = page.getByRole('dialog');
            const video = dialog.getByTestId('replay-video');
            await expect(video).toBeVisible({ timeout: 15000 });
            const firstMark = dialog.locator('[data-testid^="replay-finish-mark-"]').first();
            await expect(firstMark).toBeVisible({ timeout: 15000 });
            await firstMark.click();
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused), { timeout: 5000 })
                .toBe(true);

            // The collision: Space is meant to resume *this* video, not
            // advance the heat behind the modal.
            await page.keyboard.press(' ');
            await expect
                .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused), { timeout: 5000 })
                .toBe(false);

            // The active heat must still be the one the operator was
            // watching, not the one Space would otherwise have advanced to.
            await expect(
                page.getByRole('heading', { level: 2, name: `Heat ${activeHeat.heatNumber}` }),
            ).toBeVisible();
            await expect(
                page.getByRole('heading', { level: 2, name: `Heat ${spareNext.heatNumber}` }),
            ).toHaveCount(0);

            await dialog.getByRole('button', { name: '×' }).click();

            // Finish the spare heat so the track is not left with an
            // armed-and-never-finished heat for whatever runs after this.
            await runHeatToStart(page, spareNext.id);
            await finishHeat(page, spareNext.id);
        } finally {
            await setKeepReplays(page, { on: false });
        }
    });
});
