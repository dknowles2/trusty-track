/**
 * The entry modal for a race with no timer, for docs/race-day.md and
 * docs/reference/scoring.md#points (#490).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-manual-entry.spec.ts
 *
 * Split out rather than folded into `race-day.spec.ts`'s chain, the same
 * reasoning as `screenshot-race-stats.spec.ts`: nothing here needs the whole
 * event driven through the browser, only a race that is scored on points and
 * a track with no timer configured — so it seeds both through the API and
 * runs beside the rest of the pool.
 *
 * A track of its own, not `docsTrackId`: the shared track is `FAKE`, and
 * switching it to `NONE` here would leave every other spec that arms a heat
 * on it stuck at "Enter Results" instead of racing. Nobody else needs a
 * record off this track, so — unlike `ownTrack` calls guarding against that —
 * it is not deleted afterward; `screenshot-race-stats.spec.ts` and
 * `screenshot-observation.spec.ts` leave theirs standing for the same reason.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ensureConfigured, ownTrack, runRoundWizard, seedRace, seedRacers } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');

test('screenshot the manual result-entry modal on a track with no timer', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    // Tall enough that the Enter Results button — the whole point of picture
    // 31 — is on screen without scrolling; the four-lane heat card alone runs
    // past 900px.
    await page.setViewportSize({ width: 1200, height: 1150 });
    await ensureConfigured(page);

    const trackId = await ownTrack(page, 'Silent Track', 4, 'NONE');
    const raceId = await seedRace(page, {
        name: 'Points Derby — No Timer',
        trackId,
        dateTime: '2026-04-11T09:00:00',
        location: 'Fellowship Hall',
        scoringStrategy: 'POINTS',
        carNumberingStrategy: 'GLOBAL',
    });

    await seedRacers(page, raceId, [
        { first: 'Ana', last: 'Torres', car: 1, carName: 'Blue Streak' },
        { first: 'Owen', last: 'Park', car: 2, carName: 'Red Rocket' },
        { first: 'Maya', last: 'Chen', car: 3, carName: 'Silver Bullet' },
        { first: 'Leo', last: 'Nguyen', car: 4, carName: 'Golden Arrow' },
    ]);
    await runRoundWizard(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await page.waitForLoadState('networkidle');

    // No timer to arm means no "Waiting for Timer…" message and Enter
    // Results as the primary control — the whole point of the picture below.
    const enterResults = page.getByRole('button', { name: 'Enter Results' });
    await expect(enterResults).toBeVisible();
    await expect(page.getByText('Waiting for Timer')).not.toBeVisible();

    // 31: the race screen itself, Enter Results standing in for Override.
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '31-enter-results-no-timer.png') });

    await enterResults.click();
    const modal = page.getByRole('dialog', { name: /Edit Results/ });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Place')).toBeVisible();
    await expect(modal.getByText('Time (s)')).not.toBeVisible();

    // The finishing order as somebody at the line would call it — filled in
    // lane order, which is not the field's car-number order, so the picture
    // shows the column doing its job rather than four lanes reading 1-2-3-4
    // by coincidence.
    const placeInputs = modal.getByRole('spinbutton');
    const count = await placeInputs.count();
    for (let i = 0; i < count; i++) {
        await placeInputs.nth(i).fill(String(count - i));
    }

    // 32: the modal itself, places entered and ready to save.
    await modal.screenshot({ path: path.join(SCREENSHOT_DIR, '32-manual-place-entry-modal.png') });
});
