/**
 * The `CHECKIN` audience display view (#612), for
 * docs/observation-displays.md and docs/reference/displays.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-checkin.spec.ts
 *
 * Needs somewhere to race and nothing else — no heats, no timer, no
 * records — so it uses the shared `docsTrackId` rather than a track of its
 * own. The picture is meant to show check-in *in progress*, which is the one
 * state every other spec's roster skips straight past: `seedRacers`
 * defaults every racer to checked in, since that is what a race past
 * check-in needs, so this is the one caller that turns it off for some of
 * them.
 *
 * Reached by URL (`?view=checkin`) rather than through the Displays panel —
 * the same shortcut `screenshot-observation.spec.ts` takes for the
 * slideshow. Assigning it from Race Control would exercise the panel, which
 * is a screenshot of a different screen entirely.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, seedRace, seedRacers, seedRacingGroups } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/observation');

test('screenshot check-in progress', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);
    const trackId = await docsTrackId(page);

    const raceId = await seedRace(page, {
        name: 'Check-In Display Screenshot Race',
        trackId,
        dateTime: '2026-04-18T09:00:00',
        location: 'Fellowship Hall',
        carNumberingStrategy: 'GLOBAL',
    });

    const racingGroupIds = await seedRacingGroups(page, raceId, [
        { name: 'Wolves', color: '#8B5A2B' },
        { name: 'Bears', color: '#5B3A29' },
    ]);

    await seedRacers(
        page,
        raceId,
        [
            { first: 'Ana', last: 'Torres', car: 1, carName: 'Blue Streak', racingGroup: 'Wolves', checkedIn: true },
            { first: 'Owen', last: 'Park', car: 2, carName: 'Red Rocket', racingGroup: 'Wolves', checkedIn: false },
            { first: 'Maya', last: 'Chen', car: 3, carName: 'Silver Bullet', racingGroup: 'Wolves', checkedIn: false },
            { first: 'Leo', last: 'Nguyen', car: 4, carName: 'Golden Arrow', racingGroup: 'Bears', checkedIn: true },
            { first: 'Zoe', last: 'Adams', car: 5, carName: 'Night Owl', racingGroup: 'Bears', checkedIn: true },
        ],
        racingGroupIds,
    );

    await page.goto(`/race/${raceId}/observation?view=checkin`);
    await page.waitForLoadState('networkidle');

    const view = page.getByTestId('checkin-view');
    await expect(view).toBeVisible();
    // The caption below points at a specific den still short a car — wait
    // for the real roster rather than trusting the navigation landed after
    // the query resolved.
    await expect(view).toContainText('3 of 5 checked in');

    // 12: the check-in progress view — one den fully through, the other
    // still short two cars, each listed by number and name.
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12-checkin-progress.png') });
});
