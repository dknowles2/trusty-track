/**
 * The roster keeps working under a dark App theme (#1061).
 *
 * `.racer-row:hover` painted a literal `#f8f9fa` behind text that inherits
 * the App surface's `--text-color` — under Under the Lights that text is
 * `#eef1f6`, so hovering a row put near-white text on a near-white row
 * (~1.03:1) and effectively blanked it. Fixed in `index.css` by reading
 * `var(--surface-hover-color)`, the same token the row's own *selected*
 * state already used. This is the one check in the suite that actually
 * switches the App theme and reads computed styles back — nothing under
 * `e2e/` touched a themed screen before this issue.
 *
 * The phone-width `.racer-card` rules (`index.css`'s under-768px block) had
 * the identical problem: a literal `white`/`#333`/`#666`/etc regardless of
 * theme, so the mobile roster ignored Under the Lights entirely. That half
 * is checked here too, at the 390px viewport this suite already uses as its
 * stand-in for "a phone" (see `mobileRaceTab.spec.ts`).
 */

import { expect, test, type Page } from '@playwright/test';
import { contrastRatio } from '../../src/theming/contrast';
import { ensureConfigured, seedRace } from './support';

const APP_THEME_STORAGE_KEY = 'trustytrack.appTheme';
const UNDER_THE_LIGHTS = 'under-the-lights';

// Under the Lights' own literal values (`src/theming/themes.ts`) — the test
// checks the rendered page against these rather than re-deriving them, the
// same way `themes.test.ts` pins literals rather than importing `THEMES` and
// asserting a tautology.
const SURFACE_HOVER_HEX = '#232a3a';
const SURFACE_HEX = '#1c222c';

function rgbStringToHex(rgb: string): string {
    const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!match) throw new Error(`Not an rgb() color: ${rgb}`);
    const [, r, g, b] = match;
    return `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}

async function useUnderTheLights(page: Page): Promise<void> {
    // Set before the app's first script runs, so it reads the theme at boot
    // the same way a returning operator's own browser would — the same
    // pattern `displays.spec.ts` uses for a display's stored id.
    await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [APP_THEME_STORAGE_KEY, UNDER_THE_LIGHTS],
    );
}

test('a hovered roster row stays legible under Under the Lights (#1061)', async ({ page }) => {
    await useUnderTheLights(page);
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Roster Theme Contrast Race ' + Date.now());

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');

    const row = page.locator('.racer-row').filter({ hasText: racers[0].lastName });
    await expect(row).toBeVisible();
    await row.hover();

    const backgroundColor = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(rgbStringToHex(backgroundColor)).toBe(SURFACE_HOVER_HEX);

    const textColor = await row
        .locator('td[data-label="Last Name"]')
        .evaluate((el) => getComputedStyle(el).color);
    const ratio = contrastRatio(rgbStringToHex(textColor), rgbStringToHex(backgroundColor));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('the phone-width roster card reads the theme rather than a fixed white background (#1061)', async ({
    page,
}) => {
    await useUnderTheLights(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Roster Theme Phone Race ' + Date.now());

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('.racer-card').filter({ hasText: racers[0].lastName });
    await expect(card).toBeVisible();

    const backgroundColor = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    const hex = rgbStringToHex(backgroundColor);
    expect(hex).not.toBe('#ffffff');
    expect(hex).toBe(SURFACE_HEX);

    const nameColor = await card
        .locator('.racer-card-name')
        .evaluate((el) => getComputedStyle(el).color);
    const ratio = contrastRatio(rgbStringToHex(nameColor), hex);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
});
