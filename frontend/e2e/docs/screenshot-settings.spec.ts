/**
 * Screenshots of the System Settings panels that other pages send you to:
 * the lanes-in-service control (docs/hardware-timer.md) and the backup panel
 * (docs/backup-and-restore.md).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-settings.spec.ts
 *
 * Both panels live inside a track's own card rather than in a section of their
 * own, which is the thing the pictures are there to show — the prose can say
 * "Settings → Tracks" and still leave somebody scrolling.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/settings');

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

    // The backup panel, at the foot of the page.
    const backup = page.getByTestId('backup-panel');
    await backup.scrollIntoViewIfNeeded();
    await expect(backup).toBeVisible();
    await page.waitForTimeout(300);
    await backup.screenshot({ path: path.join(SCREENSHOT_DIR, '02-backup-panel.png') });
});
