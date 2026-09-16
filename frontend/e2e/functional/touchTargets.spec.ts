/**
 * Touch targets across the touch-facing surfaces (#1146).
 *
 * Playwright's default `Desktop Chrome` project reports `pointer: fine`, so
 * every existing spec in this suite runs against a mouse-shaped viewport and
 * never exercises `index.css`'s `@media (pointer: coarse)` rule at all. This
 * file is the first to opt a `test.describe` block into `devices['iPhone
 * 13']` (`hasTouch: true`, and — because Chromium derives `pointer`/`hover`
 * from that — `pointer: coarse`), still on the `chromium` project's own
 * browser (the project pins the engine; `test.use` only overrides context
 * options, and `defaultBrowserType` on the device preset is not one of
 * them), so the coarse-pointer rule actually fires.
 *
 * Three surfaces in the issue's table carry no shared class the CSS rule can
 * key on and get their own per-component fixes instead of a blanket
 * `min-height`/`width` — see `frontend/src/index.css`, `Modal.tsx` and
 * `RacingGroupManager.tsx` for the reasoning at each site. This spec checks
 * all of it together: the shared rule, the three exceptions, and — in the
 * second `describe` below, with no device override — that none of it leaks
 * onto a mouse.
 */

import { devices, expect, Locator, Page, test } from '@playwright/test';

import { createSchedule, ensureConfigured, gql, readHeats, recordRound, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * `boundingBox()` reports device pixels converted back to CSS ones, and the
 * iPhone 13 preset's `deviceScaleFactor: 3` means a genuine 44px CSS box
 * comes back as `43.99998474121094` rather than `44` — the size is right,
 * the float isn't. Rounded to the nearest CSS pixel before any threshold
 * check below, the same tolerance a person measuring with a ruler would
 * apply without thinking about it.
 */
async function roundedBox(locator: Locator) {
    const box = await locator.boundingBox();
    if (!box) return null;
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

// `devices['iPhone 13']` also carries `defaultBrowserType: 'webkit'`, which
// `test.use` inside a `describe` block refuses outright ("forces a new
// worker") — it is only meaningful at the top of a config's own `projects`
// list, which is where this suite already pins every spec to Chromium. Named
// explicitly rather than spread, so there is no unused `defaultBrowserType`
// pulled along with it: viewport, `hasTouch`, `isMobile` and the device
// scale factor are the ordinary context options that actually make Chromium
// report `pointer: coarse`.
const IPHONE_13_PRESET = devices['iPhone 13'];
const IPHONE_13 = {
    viewport: IPHONE_13_PRESET.viewport,
    userAgent: IPHONE_13_PRESET.userAgent,
    deviceScaleFactor: IPHONE_13_PRESET.deviceScaleFactor,
    isMobile: IPHONE_13_PRESET.isMobile,
    hasTouch: IPHONE_13_PRESET.hasTouch,
};

async function assertNoHorizontalScroll(page: Page, viewportWidth: number) {
    // A control that grows to fill a touch-target floor must not do it by
    // pushing the page wider than the screen it is now easier to tap on.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2);
}

test.describe('touch targets on a touchscreen (#1146)', () => {
    test.use({ ...IPHONE_13 });

    test('roster checkboxes are at least 20x20 on a touch viewport', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Touch Targets Roster ' + Date.now());
        await ensureConfigured(page);
        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        // The desktop table is hidden below 768px (`.desktop-only-table`);
        // only the mobile cards' own checkboxes are on screen here.
        const checkboxes = page.locator('.racer-card input[type="checkbox"]');
        const count = await checkboxes.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const box = await roundedBox(checkboxes.nth(i));
            expect(box).not.toBeNull();
            expect(box!.width).toBeGreaterThanOrEqual(20);
            expect(box!.height).toBeGreaterThanOrEqual(20);
        }

        // Tapping anywhere in the card header — not only the 16px box —
        // selects the racer, since the header is now the checkbox's label.
        const firstHeader = page.locator('.racer-card-header').first();
        const firstCheckbox = page.locator('.racer-card input[type="checkbox"]').first();
        await firstHeader.locator('.racer-card-name').click();
        await expect(firstCheckbox).toBeChecked();

        // The other half of the same claim, on a different row so it isn't
        // reading state the tap above already changed: the status pill is a
        // real, separately-clickable `<button>` inside the same `<label>`,
        // and tapping it must open Check In *without* also toggling that
        // row's own checkbox — a `<label>` with no explicit `for` binds to
        // its first labelable descendant, which used to be this button
        // (before the checkbox), so tapping *either* one forwarded to the
        // button and the checkbox never toggled at all (#1148).
        const secondCard = page.locator('.racer-card').nth(1);
        const secondCheckbox = secondCard.locator('input[type="checkbox"]');
        await expect(secondCheckbox).not.toBeChecked();
        await secondCard.locator('.racer-card-status-pill').click();
        await expect(page.getByRole('dialog', { name: 'Racer Check In' })).toBeVisible();
        await expect(secondCheckbox).not.toBeChecked();

        await assertNoHorizontalScroll(page, PHONE_VIEWPORT.width);
    });

    test('the modal close button and Manage Dens actions clear the touch floor', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Touch Targets Dens ' + Date.now());
        await gql(
            page,
            `mutation SeedDen($raceId: Int!, $racingGroup: RacingGroupInput!) {
                createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
            }`,
            { raceId, racingGroup: { name: 'Wolves', color: '#4a90d9' } },
        );
        await ensureConfigured(page);
        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        await page.getByTestId('roster-more-menu').click();
        await page.getByRole('button', { name: 'Manage Dens' }).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Every modal shares one close button (`Modal.tsx`) — a 21×28 hit
        // area before this issue.
        const closeBox = await roundedBox(dialog.getByRole('button', { name: '×' }));
        expect(closeBox).not.toBeNull();
        expect(closeBox!.width).toBeGreaterThanOrEqual(44);
        expect(closeBox!.height).toBeGreaterThanOrEqual(44);

        // Edit and Delete used to be adjacent icon-only buttons 10px apart;
        // Delete is now a labelled text button, 16px further from Edit.
        const editBox = await roundedBox(dialog.getByTitle('Edit Den'));
        const deleteBox = await roundedBox(dialog.getByTitle('Delete Den'));
        expect(editBox).not.toBeNull();
        expect(deleteBox).not.toBeNull();
        const gap = deleteBox!.x - (editBox!.x + editBox!.width);
        expect(gap).toBeGreaterThanOrEqual(16);

        await assertNoHorizontalScroll(page, PHONE_VIEWPORT.width);
    });

    test('the roster selection bar and the Race tab Re-Run button are at least 44px tall', async ({ page }) => {
        const { raceId, racers } = await seedRace(page, 'Touch Targets Buttons ' + Date.now());
        await createSchedule(page, raceId);
        await ensureConfigured(page);

        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');
        await page.locator('.racer-card input[type="checkbox"]').first().check();

        const bar = page.getByTestId('roster-selection-bar');
        await expect(bar).toBeVisible();
        for (const testId of ['bulk-check-in-btn', 'bulk-delete-btn', 'clear-selection']) {
            const box = await roundedBox(bar.getByTestId(testId));
            expect(box, testId).not.toBeNull();
            expect(box!.height, testId).toBeGreaterThanOrEqual(44);
        }
        await assertNoHorizontalScroll(page, PHONE_VIEWPORT.width);

        const heats = await readHeats(page, raceId);
        await recordRound(page, heats, racers);

        await page.goto(`/race/${raceId}/control/race`);
        await page.waitForLoadState('networkidle');

        const reRun = page.getByRole('button', { name: /Re-Run/ }).first();
        await expect(reRun).toBeVisible();
        const reRunBox = await roundedBox(reRun);
        expect(reRunBox).not.toBeNull();
        expect(reRunBox!.height).toBeGreaterThanOrEqual(44);

        await assertNoHorizontalScroll(page, PHONE_VIEWPORT.width);
    });
});

test.describe('the coarse-pointer rule does not leak onto a mouse (#1146)', () => {
    // No device override — this runs under the project's own `Desktop
    // Chrome` config (`pointer: fine`), the same as every other spec here.
    test('a roster checkbox keeps its original desktop size', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Touch Targets Desktop ' + Date.now());
        await ensureConfigured(page);
        await page.goto(`/race/${raceId}`);
        await page.waitForLoadState('networkidle');

        const checkbox = page.getByTestId('select-all-header');
        await expect(checkbox).toBeVisible();
        const box = await roundedBox(checkbox);
        expect(box).not.toBeNull();
        // Well under the 20px touch floor — this is the regression the
        // `pointer: coarse` gate exists to prevent (a plain, ungated rule
        // would have enlarged this too).
        expect(box!.width).toBeLessThan(20);
    });
});
