/**
 * Screenshots of the System Settings panels that other pages send you to:
 * the lanes-in-service control (docs/hardware-timer.md) and the backup panel
 * (docs/backup-and-restore.md).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-settings.spec.ts
 *
 * The lanes and records panels live inside a track's own card rather than in a
 * section of their own, which is the thing those pictures are there to show —
 * the prose can say "Settings → Tracks" and still leave somebody hunting for
 * the card. Backup is a section in its own right, and is photographed as one.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCREENSHOT_BACKEND_URL } from '../environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/settings');
const BACKEND_URL = SCREENSHOT_BACKEND_URL;

/** Seed through the API; the browser is for the picture, not the setup. */
async function gql(
    page: import('@playwright/test').Page,
    query: string,
    variables: Record<string, unknown> = {},
) {
    const response = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({ query, variables }),
        headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    return body.data;
}

test('screenshot the settings panels', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    // First run of the day lands on the setup wizard; a later spec may already
    // have cleared it.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/system-settings')) {
        await page.getByLabel('Organization Name').fill('Pack 42');
        await page.getByRole('button', { name: 'Save Settings' }).click();
        await page.waitForURL('**/', { waitUntil: 'networkidle' });
    }

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');

    // A configured install shows one section at a time, behind a nav down the
    // left. Every lookup below has to say which section it is in — and the
    // pictures are of the sections, so this is also the subject.
    await page.getByTestId('settings-nav-tracks').click();

    // A track is global state and these specs share one backend, so every
    // lookup here is scoped to the first track's own card. Unscoped, a spec
    // that adds a track puts a second set of these controls on the page and
    // the lookup matches two elements.
    const trackCard = page.getByTestId('track-card-0');
    await expect(trackCard.getByLabel('Lane 1 works')).toBeVisible();

    // Lane 3 out of service. It saves on click rather than on Save Settings,
    // which is what the caption in the docs claims, so the screenshot has to
    // be taken after the click rather than before it.
    // click(), not uncheck(): the box is controlled by what the server says,
    // so its state changes when the mutation comes back rather than on the
    // click, and uncheck() asserts too early.
    await trackCard.getByLabel('Lane 3 works').click();
    await expect(trackCard.getByText(/Lane 3 out of service/i)).toBeVisible();
    await page.waitForTimeout(300);

    await trackCard.screenshot({ path: path.join(SCREENSHOT_DIR, '01-lanes-in-service.png') });

    // Put it back, so a spec running after this one against the same backend
    // does not schedule a round two lanes wide for reasons it cannot see.
    await trackCard.getByLabel('Lane 3 works').click();
    await expect(trackCard.getByText(/All \d+ lanes in use/i)).toBeVisible();

    // A historical track record, entered the way an operator would: type it
    // into the card's own form and add it. Saves on click, like the lanes.
    const recordsSection = trackCard.getByTestId('track-records');
    await recordsSection.getByLabel('Record time in seconds').fill('2.891');
    await recordsSection.getByLabel('Who set the record').fill('Jimmy Alvarez');
    await recordsSection.getByLabel('Car number (optional)').fill('42');
    await recordsSection.getByLabel(/which event it was set at/i).fill('Pinewood Derby 2019');
    await recordsSection.getByLabel(/when it was set/i).fill('2019-03-16');
    await recordsSection.getByRole('button', { name: 'Add record' }).click();
    await expect(recordsSection.getByText(/Jimmy Alvarez/)).toBeVisible();
    await page.waitForTimeout(300);

    await recordsSection.screenshot({ path: path.join(SCREENSHOT_DIR, '05-track-records.png') });

    // Remove it again: the main screenshots spec photographs the Stats page
    // of a race on this track, and a record left here would put Jimmy at the
    // top of that page's record board — or not, depending on which spec ran
    // first, which is exactly the churn the seeding work exists to prevent.
    await recordsSection.getByRole('button', { name: /remove the record held by jimmy alvarez/i }).click();
    await expect(recordsSection.getByText(/Jimmy Alvarez/)).not.toBeVisible();

    // The Access panel, with a PIN set so the Remove control is on screen —
    // it is only offered for a PIN that exists, and it is the whole subject of
    // the "changing or removing a PIN" section (#192).
    // Saving leaves this page — and, when the PIN changed, reloads so the
    // subscription socket picks the new credential up. Come back to it.
    await page.getByTestId('settings-nav-access').click();
    await page.getByLabel('Operator PIN').fill('1234');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForURL('**/', { waitUntil: 'networkidle' });
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-access').click();
    await expect(page.getByTestId('operator_pin-remove')).toBeVisible();
    await page.waitForTimeout(300);
    await page
        .getByTestId('access-panel')
        .screenshot({ path: path.join(SCREENSHOT_DIR, '03-access-pins.png') });

    // Put it back: a PIN set here would follow every other spec on this shared
    // backend into every mutation they make.
    await page.getByTestId('operator_pin-remove').click();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForURL('**/', { waitUntil: 'networkidle' });
    await page.goto('/system-settings');
    await page.getByTestId('settings-nav-access').click();
    await expect(page.getByTestId('operator_pin-remove')).toHaveCount(0);

    // The backup panel, which is a section of its own now — it used to be at
    // the foot of the page, below every track.
    await page.getByTestId('settings-nav-backup').click();
    const backup = page.getByTestId('backup-panel');
    await backup.scrollIntoViewIfNeeded();
    await expect(backup).toBeVisible();
    await page.waitForTimeout(300);
    await backup.screenshot({ path: path.join(SCREENSHOT_DIR, '02-backup-panel.png') });

    // The activity log (#219). It needs something to show, so make a little
    // history first — including one thing a person did by hand, so the
    // picture carries the distinction the page exists to draw.
    const race = await gql(
        page,
        `mutation ActivityShotRace($race: RaceInput!) {
            createRace(race: $race) { id }
        }`,
        {
            race: {
                name: 'Activity Shot Derby',
                groupId: 1,
                trackId: 1,
                carNumberingStrategy: 'GLOBAL',
            },
        },
    );
    await gql(
        page,
        `mutation ActivityShotDen($raceId: Int!, $den: DenInput!) {
            createDen(raceId: $raceId, den: $den) { id }
        }`,
        { raceId: race.createRace.id, den: { name: 'Wolves', color: '#8B4513' } },
    );
    await gql(
        page,
        `mutation ActivityShotRacer($racer: RacerInput!) {
            createRacer(racer: $racer) { id }
        }`,
        {
            racer: {
                raceId: race.createRace.id,
                firstName: 'Alex',
                lastName: 'Rivera',
                carNumber: 3,
            },
        },
    );

    await page.goto('/activity');
    await expect(page.getByText('Created a race').first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-activity-log.png') });
});
