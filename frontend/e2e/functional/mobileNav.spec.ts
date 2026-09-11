/**
 * On a phone, no race page said which race it was in (#952).
 *
 * Under 768px `Navigation.tsx` swapped the header for logo + hamburger and
 * dropped both the race-selector pill and the race-nav row, so nothing on
 * screen named the race and every page change went through the drawer. This
 * covers what replaced that: the race's own name in the mobile header, and a
 * bottom tab bar carrying the same six links `Navigation.tsx` already builds
 * for the desktop row — see "One row of race navigation" in
 * `.claude/rules/frontend-screens.md`.
 *
 * Two viewports, because 768px is the boundary the JS breakpoint was
 * (accidentally) not matching the CSS `max-width: 768px` rules at — #952's
 * own report verified at 390px, and the boundary itself is worth pinning so
 * it cannot drift back to `< 768` unnoticed.
 */

import { expect, test } from '@playwright/test';

import { ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const BOUNDARY_VIEWPORT = { width: 768, height: 1024 };

for (const viewport of [PHONE_VIEWPORT, BOUNDARY_VIEWPORT]) {
    test(`the race name is in the header and the six tabs work at ${viewport.width}px (#952)`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const raceName = `Mobile Nav ${viewport.width} ${Date.now()}`;
        const { raceId } = await seedRace(page, raceName);
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        // The race's own name replaces the hidden desktop pill and race-nav
        // row — nothing else on the Roster page's own heading says which
        // race this is.
        const pill = page.getByTestId('race-selector-pill-mobile');
        await expect(pill).toBeVisible();
        await expect(pill).toContainText(raceName);

        // The desktop-only surfaces stay gone.
        await expect(page.getByTestId('race-nav')).not.toBeVisible();
        await expect(page.getByLabel('Open Menu')).toBeVisible();

        // The bottom tab bar carries the same six links as the desktop row,
        // reachable with no drawer in between.
        const tabBar = page.getByTestId('mobile-tab-bar');
        await expect(tabBar).toBeVisible();
        for (const label of ['Roster', 'Control', 'Standings', 'Awards', 'Stats', 'Live']) {
            await expect(tabBar.getByText(label, { exact: true })).toBeVisible();
        }

        // Tapping a tab navigates, without opening the drawer.
        await tabBar.getByText('Standings', { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/race/${raceId}/standings$`));
        // No heats have been run, so the page reports that rather than a
        // table — this is asserting the navigation landed, not the content.
        await expect(page.getByText('No results yet. Complete some heats to see standings!')).toBeVisible();
        await expect(tabBar).toBeVisible();

        // The pill still opens the drawer, scrolled to this race's own
        // entry, exactly as the hamburger does.
        await page.getByTestId('race-selector-pill-mobile').click();
        const drawer = page.getByTestId('mobile-drawer');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByText(raceName)).toBeInViewport();
    });
}

test('the tab bar is absent in projector mode, exactly as the header is (#952)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, `Mobile Nav Projector ${Date.now()}`);
    await ensureConfigured(page);

    await page.goto(`/race/${raceId}/observation?projector=true`);
    await page.waitForLoadState('networkidle');

    // The whole of `Navigation` returns null in projector mode (ChromeContext
    // is the general mechanism; the URL is the fallback for a display nobody
    // has assigned anything) — the tab bar shares that hide rather than
    // carrying a second flag of its own.
    await expect(page.getByTestId('mobile-tab-bar')).toHaveCount(0);
    await expect(page.getByTestId('race-selector-pill-mobile')).toHaveCount(0);
    await expect(page.getByLabel('Open Menu')).toHaveCount(0);
});
