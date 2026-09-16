/**
 * Phone chrome and density (#1148).
 *
 * Under 768px — the same width `Navigation.tsx`'s own `MOBILE_BREAKPOINT`
 * puts a bottom tab bar on — several operator pages repeated the tab bar's
 * own label as a page heading, and the roster's check-in queue fit only
 * 1.5 racers on an 844px screen:
 *
 * - Race Control's "Race Control" heading said what the bottom tab bar's
 *   "Control" label already said, ahead of a "Schedule / Race / Free Race"
 *   strip and a centred "Edit race" pill, pushing the heat card to about
 *   240px from the top.
 * - The Roster page's sticky region (heading, check-in progress, the full
 *   toolbar, search, the group toggle) ran to about 330px before the first
 *   racer card, and each card was tall enough (avatar, name, a den row, a
 *   full-width status button) that only 1.5 fit on screen.
 * - Standings, Awards and Stats each carried a row of buttons that wrapped
 *   their own labels onto a second line at 390px.
 *
 * This file checks the fix at 390×844 (the same phone width every other
 * mobile spec in this suite uses) and confirms nothing changed at
 * 1280×800, where the docs screenshots are taken.
 */

import { expect, Locator, Page, test } from '@playwright/test';

import { createSchedule, ensureConfigured, gql, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

/** Ten more racers on top of `seedRace`'s own six, all checked in — the
 * roster density assertions below want "≥10 racers" and a check-in queue
 * already under way (so the setup checklist has collapsed to one line,
 * same as a real morning at the check-in table rather than a freshly
 * created race with an empty roster). */
async function addAndCheckInRacers(page: Page, raceId: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation AddRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            {
                racer: {
                    raceId,
                    firstName: `Extra${i}`,
                    lastName: 'Racer',
                    carNumber: 100 + i,
                },
            },
        );
        await gql(
            page,
            `mutation CheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
    }
}

/** Whether any text node inside `locator` wraps onto more than one line —
 * the same text-node-walking check `raceTabActionRow.spec.ts` uses, since
 * a fixed inline `height` on these buttons makes `boundingBox().height`
 * unable to tell a wrapped label from an unwrapped one. */
async function isWrapped(locator: Locator): Promise<boolean> {
    return locator.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent || !node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const tops = new Set(
                Array.from(range.getClientRects())
                    .filter((r) => r.width > 0 && r.height > 0)
                    .map((r) => Math.round(r.top)),
            );
            if (tops.size > 1) return true;
        }
        return false;
    });
}

test.describe('phone chrome at 390×844 (#1148)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('Race Control: no repeated "Race Control" heading, the tab strip is the first row, and the heat card sits well above the fold', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Mobile Chrome Control ' + Date.now());
        await createSchedule(page, raceId);
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}/control`);
        await page.waitForLoadState('networkidle');

        // No visible "Race Control" heading — the bottom tab bar's own
        // "Control" label already says this.
        await expect(page.getByRole('heading', { name: 'Race Control' })).toHaveCount(0);

        // The tab strip is the first interactive row on the page.
        const mobileHeader = page.getByTestId('race-control-mobile-header');
        await expect(mobileHeader).toBeVisible();
        const scheduleTab = mobileHeader.getByRole('button', { name: /Schedule/ });
        await expect(scheduleTab).toBeVisible();
        const headerBox = await mobileHeader.boundingBox();
        expect(headerBox).not.toBeNull();
        // Nothing above it but the app's own top nav.
        expect(headerBox!.y).toBeLessThan(120);

        // The heat card starts well above the old ~240px mark.
        await page.goto(`/race/${raceId}/control/race`);
        await page.waitForLoadState('networkidle');
        const heatCard = page.getByTestId('race-execution-active-card');
        await expect(heatCard).toBeVisible();
        const cardBox = await heatCard.boundingBox();
        expect(cardBox).not.toBeNull();
        expect(cardBox!.y).toBeLessThan(140);
    });

    test('Race Control: Edit race is reachable from the overflow and opens the roster\'s edit modal', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Mobile Chrome Edit Race ' + Date.now());
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}/control`);
        await page.waitForLoadState('networkidle');

        await page.getByTestId('race-control-overflow').click();
        await page.getByTestId('race-control-edit-race').click();

        await expect(page.getByRole('dialog', { name: 'Edit Race Details' })).toBeVisible();
    });

    test('Roster: rows are dense — first row near the top, each row compact, at least 7 on screen', async ({ page }) => {
        const raceName = 'Mobile Chrome Roster ' + Date.now();
        const { raceId } = await seedRace(page, raceName);
        await addAndCheckInRacers(page, raceId, 6); // 6 + seedRace's own 6 = 12

        await ensureConfigured(page);
        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        const rows = page.locator('.mobile-only-cards .racer-card');
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(10);

        const firstBox = await rows.first().boundingBox();
        expect(firstBox).not.toBeNull();
        expect(firstBox!.y).toBeLessThan(200);

        let visibleWithinViewport = 0;
        for (let i = 0; i < count; i++) {
            const box = await rows.nth(i).boundingBox();
            if (!box) continue;
            expect(box.height, `row ${i} height`).toBeLessThanOrEqual(72);
            if (box.y + box.height <= PHONE_VIEWPORT.height) visibleWithinViewport++;
        }
        expect(visibleWithinViewport).toBeGreaterThanOrEqual(7);
    });

    test('Roster: the sticky region with rows selected stays well under the old ~500px', async ({ page }) => {
        // The issue's own headline number: with two rows ticked, the sticky
        // region (then holding the heading, check-in progress, the full
        // toolbar, search *and* the selection bar all at once) ran to about
        // 500px. It now holds only search plus the selection bar.
        const { raceId } = await seedRace(page, 'Mobile Chrome Roster Selection ' + Date.now());
        await ensureConfigured(page);
        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        const checkboxes = page.locator('.racer-card input[type="checkbox"]');
        await checkboxes.nth(0).check();
        await checkboxes.nth(1).check();
        await expect(page.getByTestId('roster-selection-bar')).toBeVisible();

        const box = await page.locator('.roster-header').boundingBox();
        expect(box).not.toBeNull();
        // Measured locally at 168px (a 32px search box plus a two-row-wide
        // selection bar). 250px leaves comfortable margin for font/OS
        // rendering differences while still catching a regression anywhere
        // near the issue's own 500px number — a new bulk-action button
        // wrapping the selection bar onto a second line, say.
        expect(box!.height).toBeLessThan(250);
    });

    test('Roster: Edit race is reachable from the roster\'s own overflow', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Mobile Chrome Roster Edit ' + Date.now());
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        await page.getByTestId('roster-more-menu').click();
        await page.getByTestId('edit-race-btn').click();

        await expect(page.getByRole('dialog', { name: 'Edit Race Details' })).toBeVisible();
    });

    for (const { path, label } of [
        { path: 'standings', label: 'Standings' },
        { path: 'awards', label: 'Awards' },
        { path: 'stats', label: 'Stats' },
    ]) {
        test(`${label}: fits 390px with no button wrapping`, async ({ page }) => {
            const { raceId } = await seedRace(page, `Mobile Chrome ${label} ` + Date.now());
            await ensureConfigured(page);

            await page.goto(`/race/${raceId}/${path}`);
            await page.waitForLoadState('networkidle');

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

            const buttons = page.locator('button:visible, a.secondary-btn:visible, a.primary-btn:visible');
            const count = await buttons.count();
            for (let i = 0; i < count; i++) {
                const button = buttons.nth(i);
                expect(await isWrapped(button), `button "${await button.innerText()}" wrapped`).toBe(false);
            }
        });
    }
});

test.describe('desktop at 1280×800 stays unchanged (#1148)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('Race Control and Roster still render their headings and Edit race pill', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Desktop Chrome Unchanged ' + Date.now());
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}/control`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { name: 'Race Control' })).toBeVisible();
        const controlEdit = page.getByTestId('race-control-edit-race');
        await expect(controlEdit).toBeVisible();

        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('edit-race-btn')).toBeVisible();
    });

    test('Awards still renders its own heading', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Desktop Chrome Awards ' + Date.now());
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}/awards`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { name: 'Awards' })).toBeVisible();
    });
});
