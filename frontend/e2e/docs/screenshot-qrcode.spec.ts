/**
 * The `QRCODE` audience display view (#614), for
 * docs/observation-displays.md and docs/reference/displays.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-qrcode.spec.ts
 *
 * Needs somewhere to race and nothing else — no heats, no timer, no
 * records — so it uses the shared `docsTrackId` rather than a track of its
 * own, the same reason `screenshot-checkin.spec.ts` does.
 *
 * Reached by URL (`?view=qrcode&qr_target=vote`) rather than through the
 * Displays panel, the same shortcut every other single-view screenshot in
 * this directory takes — assigning it from Race Control would be a
 * screenshot of a different screen entirely. `qr_target=vote` rather than
 * the default, so the picture matches the caption's own claim that this is
 * the ballot's address, which is also the one a `qrHeadline` naming voting
 * makes sense next to.
 *
 * The exact address encoded in the code (this machine's own LAN address)
 * differs between environments and is not asserted on — the same "about a
 * dozen images differ run to run" allowance every other screenshot spec's
 * environment-derived content gets.
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { docsTrackId, ensureConfigured, seedRace } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/observation');

test('screenshot qr code display', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);
    const trackId = await docsTrackId(page);

    const raceId = await seedRace(page, {
        name: 'QR Code Display Screenshot Race',
        trackId,
        dateTime: '2026-05-02T09:00:00',
        location: 'Fellowship Hall',
        carNumberingStrategy: 'GLOBAL',
        qrHeadline: 'Scan to Vote for Best in Show!',
        qrWifiNote: 'Connect to the Fellowship Hall Guest Wi-Fi',
    });

    await page.goto(`/race/${raceId}/observation?view=qrcode&qr_target=vote`);
    await page.waitForLoadState('networkidle');

    const view = page.getByTestId('qrcode-view');
    await expect(view).toBeVisible();
    // Waits for the settled headline rather than trusting the navigation
    // landed after the race query resolved — `race-day.spec.ts`'s own rule
    // for a screenshot that races the data it photographs.
    await expect(view).toContainText('Scan to Vote for Best in Show!');
    await expect(view).toContainText('Connect to the Fellowship Hall Guest Wi-Fi');
    // The code itself, not the "could not find an address" warning — the
    // runner this spec is on is expected to have an ordinary network route.
    await expect(page.getByAltText(/qr code/i)).toBeVisible();

    // 13: the QR code view, pointed at the voting ballot, with a custom
    // headline and Wi-Fi line the race set on its own edit form.
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '13-qrcode.png') });
});
