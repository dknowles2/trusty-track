/**
 * Free Race's setup screen on a phone (issue #1141).
 *
 * The Random/Manual/Anonymous segmented control (`FreeRaceLaneSetup.tsx`,
 * `MODES` near the top) was a `nowrap` flex row that measured 431px against
 * a 390px viewport, so `document.scrollWidth` came out 431 and every panel
 * on the page scrolled sideways with it. Each lane card was a two-line,
 * 80px-avatar block, which — on a 4-lane track — pushed "Start Free Race
 * Heat" about 1,100px down the page and wrapped "Re-shuffle" to two lines
 * beside it.
 *
 * `mobileRaceTab.spec.ts` and `mobileSchedule.spec.ts` are the shape this
 * follows: seed through the API, drive the one screen under test with a real
 * browser, and measure the geometry directly rather than trust that "it
 * looks fine".
 */

import { expect, test } from '@playwright/test';

import { ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test('Free Race setup fits a 390px phone without scrolling sideways or burying Start (#1141)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Mobile Free Race Layout ' + Date.now());
    await ensureConfigured(page);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/control/free-race`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Free Race Setup')).toBeVisible();
    // `randomFreeRaceLanes` is its own query, fired after the setup screen
    // itself has rendered (`screenshot-free-race.spec.ts` hit the same
    // race) — wait for the draw rather than guess how long it takes.
    await expect(page.getByText('Loading random assignments...')).toBeHidden();

    // The document itself must not be forced wider than the phone — the
    // observable shape of #1141: a `nowrap` segmented control (measured at
    // 431px in the report) forcing the whole page to scroll sideways.
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // The mode control itself sits inside the viewport, not merely the
    // document as a whole — a control that overflows its own row while
    // something else absorbs the scrollbar would pass the check above and
    // still be the bug.
    const modeControl = page.locator('.free-race-mode-control');
    const modeControlBox = await modeControl.boundingBox();
    expect(modeControlBox).not.toBeNull();
    expect(modeControlBox!.x).toBeGreaterThanOrEqual(0);
    expect(modeControlBox!.x + modeControlBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // Every lane row is compact — one line, the Race tab's own ~56px shape
    // rather than the 80px-avatar two-line card, with a little slack for
    // the report's own "≤ 64px" ceiling.
    const laneRows = page.locator('.free-race-lane-row');
    const laneRowCount = await laneRows.count();
    expect(laneRowCount).toBeGreaterThan(0);
    for (let i = 0; i < laneRowCount; i++) {
        const box = await laneRows.nth(i).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThanOrEqual(64);
    }

    // The primary button sits at the bottom, inside the viewport, and is
    // genuinely full width — not merely "wider than it was".
    const startBtn = page.getByRole('button', { name: /Start (Free Race|Anonymous) Heat/i });
    const startBox = await startBtn.boundingBox();
    const panelBox = await page.locator('.free-race-panel').boundingBox();
    expect(startBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(startBox!.x).toBeGreaterThanOrEqual(0);
    expect(startBox!.x + startBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    expect(startBox!.width).toBeGreaterThanOrEqual(panelBox!.width * 0.9);

    // Re-shuffle (random mode's own secondary action, on screen by default)
    // reads on one line — a wrapped "Re- / shuffle" roughly doubles the
    // button's own height, so a generous single-line ceiling catches it
    // without hardcoding an exact pixel count for one line of this font.
    const reshuffleBtn = page.getByRole('button', { name: /Re-shuffle/i });
    const reshuffleBox = await reshuffleBtn.boundingBox();
    expect(reshuffleBox).not.toBeNull();
    expect(reshuffleBox!.height).toBeLessThanOrEqual(48);
    // And it sits above Start, not beside it — a secondary action reads
    // top-to-bottom into the primary one it leads into on a phone.
    expect(reshuffleBox!.y).toBeLessThan(startBox!.y);
});

test('Free Race setup keeps its desktop layout at 1280px (#1141)', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Desktop Free Race Layout ' + Date.now());
    await ensureConfigured(page);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/race/${raceId}/control/free-race`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Free Race Setup')).toBeVisible();
    await expect(page.getByText('Loading random assignments...')).toBeHidden();

    // The label is still on screen next to the icon at desktop width — the
    // icon-only compacting under ~420px (index.css) must not have leaked
    // into wider viewports.
    await expect(page.getByRole('button', { name: 'Random' }).getByText('Random')).toBeVisible();
});
