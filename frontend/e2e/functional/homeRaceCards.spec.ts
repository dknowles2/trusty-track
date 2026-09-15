/**
 * Home's race list on a phone or portrait tablet (#1137).
 *
 * `Home.tsx` rendered the race list as a `<table>` inside `overflowX: auto`
 * with four columns hidden under 768px (`.mobile-hide`) — but the Quick
 * Actions cell still held Control, Displays and the `⋯` menu side by side.
 * At 390px only "name · status · Control" fit; Displays and `⋯` were off
 * the right edge with no scroll cue. At 820px (tablet portrait) nothing was
 * hidden and the table needed ~950px, so the row was clipped there too. The
 * `⋯` dropdown was also inside the table's own `overflow: auto` wrapper, so
 * even a reachable open clipped at the scroll boundary.
 *
 * Below 900px, `Home.tsx` now renders one card per race instead — see
 * `CARD_BREAKPOINT` there. Each test below scopes its assertions to the one
 * race it just seeded (by id) rather than "the first race on the page",
 * since this suite runs several specs against one shared backend and Home
 * lists every race that has ever existed (`.claude/rules/roster.md`'s "The
 * Home page race list") — a race created by another spec running at the
 * same time could otherwise land above or below this one.
 */

import { expect, test } from '@playwright/test';

import { seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const TABLET_PORTRAIT_VIEWPORT = { width: 820, height: 1180 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

for (const viewport of [PHONE_VIEWPORT, TABLET_PORTRAIT_VIEWPORT]) {
    test(`the race card's Displays control and ⋯ menu are fully on screen at ${viewport.width}px (#1137)`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        const { raceId } = await seedRace(page, `Home Cards ${viewport.width} ${Date.now()}`);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const card = page.getByTestId(`race-card-${raceId}`);
        await expect(card).toBeVisible();

        // Displays sits fully inside the viewport — the symptom the issue
        // reports is this control landing off the right edge with no way
        // to reach it.
        const displaysLink = card.getByRole('link', { name: /Displays/ });
        await expect(displaysLink).toBeVisible();
        const displaysBox = await displaysLink.boundingBox();
        expect(displaysBox).not.toBeNull();
        expect(displaysBox!.x + displaysBox!.width).toBeLessThanOrEqual(viewport.width);

        // Same for the `⋯` overflow button.
        const moreButton = page.getByTestId(`race-more-menu-${raceId}`);
        await expect(moreButton).toBeVisible();
        const moreBox = await moreButton.boundingBox();
        expect(moreBox).not.toBeNull();
        expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(viewport.width);

        // Opening it shows a menu that is itself fully visible — not
        // clipped horizontally, which used to happen because the dropdown
        // sat inside the table's own `overflow: auto` scroll wrapper (the
        // right-hand portion of the menu was scrolled out of that
        // container's own reach rather than merely off past the bottom of
        // a tall page, which a real menu is allowed to be). The card has
        // no such wrapper. Every menu item, not just the last, since a
        // wrapper narrower than the menu itself would clip only some of
        // them depending on where each button happened to sit.
        await moreButton.click();
        for (const action of ['roster', 'standings', 'print', 'edit']) {
            const menuItem = page.getByTestId(`race-menu-${action}-${raceId}`);
            await expect(menuItem).toBeVisible();
            const menuBox = await menuItem.boundingBox();
            expect(menuBox).not.toBeNull();
            expect(menuBox!.x).toBeGreaterThanOrEqual(0);
            expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
        }

        // The document itself is never forced wider than its own viewport.
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    });
}

test('the race list is a table again at 1280x800 (#1137)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const { raceId } = await seedRace(page, `Home Cards Desktop ${Date.now()}`);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByTestId('race-cards')).toHaveCount(0);

    // The same race, reached the table's own way.
    await expect(page.getByTestId(`race-more-menu-${raceId}`)).toBeVisible();
});
