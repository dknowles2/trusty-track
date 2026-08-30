/**
 * Screenshots of the System Settings panels that other pages send you to:
 * the terminology fields (docs/reference/race-settings.md#the-words-on-screen),
 * the timer-type dropdown (docs/fake-timer.md), the lanes-in-service control
 * (docs/hardware-timer.md) and the backup panel (docs/backup-and-restore.md).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-settings.spec.ts
 *
 * The timer, lanes and records panels live inside a track's own card rather
 * than in a section of their own, which is the thing those pictures are there
 * to show — the prose can say "Settings → Tracks" and still leave somebody
 * hunting for the card. Backup is a section in its own right, and is
 * photographed as one.
 *
 * The Access panel and the activity log are *not* here, though their pictures
 * are filed alongside these. They belong to the install rather than to a track,
 * and one of them sets an operator PIN — while a PIN is set, every caller
 * without one is a VIEWER and no mutation is allowed (#15), which would stop
 * every spec running beside this. Both live in `screenshot-first-run.spec.ts`,
 * the one spec that runs on its own.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ensureConfigured, ownTrack } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/settings');

/** This spec's own track. Three lanes, matching the one the wizard creates,
 *  so "2 of 3 lanes in use" reads the same as it always has. */
const TRACK_NAME = 'Gym Track';

test('screenshot the settings panels', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);
    await ownTrack(page, TRACK_NAME, 3);

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');

    // A configured install shows one section at a time, behind a nav down the
    // left. Every lookup below has to say which section it is in — and the
    // pictures are of the sections, so this is also the subject.

    // Terminology (#496 stage 5), for docs/reference/race-settings.md#the-words-on-screen.
    // Lives in General, first in the section order, so this is the picture
    // taken before anything else — before the checkbox is switched on, the
    // section holds only the organization name and debug toggle. Local,
    // unsaved form state, the same reasoning as the Appearance preview below:
    // this spec runs beside others that assume the install's own terminology
    // is still the built-in default, so Save Settings is never clicked here.
    await page.getByTestId('settings-nav-general').click();
    const terminologyFields = page.getByTestId('terminology-fields');
    await expect(terminologyFields).toBeVisible();
    await terminologyFields.getByLabel('Use different words for “Den”, “Pack” and “Car”').click();
    await terminologyFields.getByLabel('One racing group (was “Den”)').fill('Class');
    await terminologyFields.getByLabel('More than one (was “Dens”)').fill('Classes');
    await terminologyFields.getByLabel('The organization itself (was “Pack”)').fill('School');
    await terminologyFields.getByLabel('More than one (was “Packs”)').fill('Schools');
    await terminologyFields.getByLabel('One vehicle (was “Car”)').fill('Rocket');
    await terminologyFields.getByLabel('More than one (was “Cars”)').fill('Rockets');
    await expect(terminologyFields.getByLabel('One racing group (was “Den”)')).toHaveValue('Class');
    await terminologyFields.screenshot({ path: path.join(SCREENSHOT_DIR, '09-terminology.png') });

    await page.getByTestId('settings-nav-tracks').click();

    // This spec's own card, found by the name in its own input rather than by
    // position. Both pictures below are taken by *changing* the track — a lane
    // goes out of service, a record is added — and this spec now runs beside
    // the others, six of which schedule races on the shared track. Two lanes
    // where a spec expected three is a wrong picture with no error behind it.
    const trackCard = page
        .getByTestId(/track-card-\d+/)
        .filter({ has: page.locator(`input[value="${TRACK_NAME}"]`) });
    await expect(trackCard.getByLabel('Lane 1 works')).toBeVisible();

    // The timer section, for docs/fake-timer.md — ownTrack() creates every
    // track with timerType FAKE, so this is the dropdown's default state, not
    // one this spec has to switch to. Cropped to "The timer" rather than the
    // whole card: the fake-timer guide's picture is about the dropdown, not
    // the track's name or lane count.
    const timerSection = trackCard.getByTestId('track-timer');
    await expect(timerSection.getByLabel('Timer Type')).toHaveValue('FAKE');
    await timerSection.screenshot({ path: path.join(SCREENSHOT_DIR, '06-fake-timer-selected.png') });

    // No timer at all (#490), for docs/reference/race-settings.md#no-timer.
    // Neither screenshot is followed by Save Settings — the dropdown's value
    // is what the picture is of, and nothing downstream in this spec reads
    // the track's actual timer type, so there is nothing to persist or put
    // back.
    await timerSection.getByLabel('Timer Type').selectOption('NONE');
    await expect(timerSection.getByLabel('Timer Model')).toBeHidden();
    await timerSection.screenshot({ path: path.join(SCREENSHOT_DIR, '07-no-timer-selected.png') });
    await timerSection.getByLabel('Timer Type').selectOption('FAKE');

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

    // Removed again. Nothing races on this track, so the record could stay —
    // but the picture is of *adding* one, and a spec that tidies up after
    // itself is one less thing for the next person to reason about.
    await recordsSection.getByRole('button', { name: /remove the record held by jimmy alvarez/i }).click();
    await expect(recordsSection.getByText(/Jimmy Alvarez/)).not.toBeVisible();

    // The Appearance section (#498): three theme pickers and a live preview,
    // for docs/reference/themes.md. Only the *picker selection* is exercised
    // here, never Save Settings — Display and Printables are install-wide,
    // and this spec runs in the parallel pool beside others that assume
    // Field Uniform / Match App is what the install is actually set to.
    // The preview updates from local, unsaved component state, which is
    // what makes a real picture possible without ever touching the
    // install's own settings the way the Access panel and the activity log
    // cannot (see this file's own header comment).
    await page.getByTestId('settings-nav-appearance').click();
    const appearancePanel = page.getByTestId('appearance-panel');
    await expect(appearancePanel).toBeVisible();

    await page.getByTestId('app-theme-option-old-glory').click();
    await page.getByTestId('display-theme-option-old-glory').click();
    await page.getByTestId('printables-theme-option-old-glory').click();
    await expect(page.getByTestId('app-theme-option-old-glory')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('appearance-preview')).toBeVisible();
    await page.waitForTimeout(200);

    await appearancePanel.screenshot({ path: path.join(SCREENSHOT_DIR, '08-appearance-old-glory.png') });

    // The backup panel, which is a section of its own now — it used to be at
    // the foot of the page, below every track.
    await page.getByTestId('settings-nav-backup').click();
    const backup = page.getByTestId('backup-panel');
    await backup.scrollIntoViewIfNeeded();
    await expect(backup).toBeVisible();
    await page.waitForTimeout(300);
    await backup.screenshot({ path: path.join(SCREENSHOT_DIR, '02-backup-panel.png') });
});
