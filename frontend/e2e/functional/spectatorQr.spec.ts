/**
 * A phone that reaches the Live page by scanning the wall's QR code must not
 * register as a display (#1182).
 *
 * `qrCode.ts`'s `qrTargetPath` carries `?spectator=1` on the `STANDINGS`
 * target when called with `{ spectator: true }` — the audience-facing QR
 * code's own case; `Observation.tsx` reads it to skip the
 * `displayAssignment` subscription, which is both how a display registers
 * and the only way it is ever told anything (`displays.spec.ts`'s own
 * header comment). No unit test can see the actual consequence — that the
 * operator's Displays list, backed by a live subscription over a real
 * backend, never gains a row for it — so this is the round trip.
 *
 * Two browser contexts, the same shape `displays.spec.ts` uses throughout:
 * the phone and the operator are different machines, and a display holds no
 * PIN.
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, seedRace, createSchedule, readHeats, recordRound } from './support';

const PHONE = { width: 390, height: 844 };

/** A race with Now Racing / standings actually populated: a schedule, most
 * of it recorded, the last couple of heats left to run. */
async function seedRacingRace(page: Page, name: string) {
    const { raceId, racers } = await seedRace(page, name);
    await createSchedule(page, raceId);
    const heats = await readHeats(page, raceId);
    // Leave the last two heats unrecorded, the same margin
    // `mobileAudience.spec.ts` uses, so Now Racing / On Deck stay populated
    // rather than the page falling through to "No heat scheduled".
    await recordRound(page, heats.slice(0, Math.max(0, heats.length - 2)), racers);
    return raceId;
}

test.describe('a phone that scans the QR code is a spectator (#1182)', () => {
    test('does not register as a display, though it still shows live results', async ({ browser, page }) => {
        await ensureConfigured(page);
        const raceId = await seedRacingRace(page, `Spectator QR Race ${Date.now()}`);

        // Nobody has connected yet.
        await page.goto(`/race/${raceId}/displays`);
        await expect(page.locator('[data-testid^="display-"]')).toHaveCount(0);

        // A fresh context: a different machine, exactly like a parent's own
        // phone — and the QR code's own target, `?spectator=1`.
        const phoneContext = await browser.newContext({ viewport: PHONE });
        const phone = await phoneContext.newPage();
        await phone.goto(`/race/${raceId}/observation?spectator=1`);

        // The page says which mode it is in, and it still shows racing.
        await expect(phone.locator('[data-spectator="true"]')).toBeVisible();
        await expect(phone.getByTestId('observation-standard-phone')).toBeVisible();
        await expect(phone.locator('.standing-row').first()).toBeVisible();

        // Give the subscription every chance to have registered, if it were
        // going to — long enough that a real registration would already be
        // visible on the operator's own live list (`displays.spec.ts`'s
        // registrations land well inside its own 10s assertion timeouts).
        await phone.waitForTimeout(3000);

        await expect(page.locator('[data-testid^="display-"]')).toHaveCount(0);

        await phoneContext.close();
    });

    test('control: the same page opened with no flag registers normally', async ({ browser, page }) => {
        await ensureConfigured(page);
        const raceId = await seedRacingRace(page, `Spectator QR Control Race ${Date.now()}`);

        await page.goto(`/race/${raceId}/displays`);
        await expect(page.locator('[data-testid^="display-"]')).toHaveCount(0);

        const phoneContext = await browser.newContext({ viewport: PHONE });
        const phone = await phoneContext.newPage();
        // The address an operator opens by hand, or types into a screen —
        // no `?spectator=1` — proving test (a) is not vacuous: something
        // about *this* page is capable of registering.
        await phone.goto(`/race/${raceId}/observation`);

        await expect(phone.locator('[data-spectator="true"]')).toHaveCount(0);
        await expect(page.locator('[data-testid^="display-"]')).toHaveCount(1, { timeout: 15000 });

        await phoneContext.close();
    });

    test('the QR code view itself points at the spectator flag', async ({ browser, page }) => {
        // The actual code a phone scans (`QRCodeDisplayView.tsx`, the
        // `QRCODE` view an operator can assign to a wall screen) — proving
        // the flag reaches the rendered payload, not only the path helper
        // `qrCode.test.ts` already covers in isolation.
        await ensureConfigured(page);
        const raceId = await seedRacingRace(page, `Spectator QR Code View Race ${Date.now()}`);

        const wallContext = await browser.newContext();
        const wall = await wallContext.newPage();
        await wall.goto(`/race/${raceId}/observation?view=qrcode`);

        await expect(wall.getByTestId('qrcode-view')).toBeVisible();
        // The address printed under the code is the same text the QR image
        // itself encodes (`QRCodeDisplayView.tsx`'s own `{url}`), so reading
        // it here is reading the actual payload a phone would scan.
        await expect(wall.getByText(/\/race\/\d+\/observation\?spectator=1$/)).toBeVisible();

        await wallContext.close();
    });
});
