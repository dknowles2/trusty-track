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

async function openCamera(page: Page, raceId: number, id: string) {
    await page.goto(`/race/${raceId}/camera?fake=1&displayId=${id}`);
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
        { timeout: 30000 },
    );
    await finishHeat(page, replayWarmUp.id);
    await warmClipUpload;
    await display.waitForTimeout(2000);

    // The heat under test.
    await runHeatToStart(page, underTest.id);
    const uploadResponse = camera.waitForResponse(
        (r) => r.url().includes('/replay/') && r.request().method() === 'POST',
        { timeout: 30000 },
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
        { timeout: 30000 },
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
        { timeout: 30000 },
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
