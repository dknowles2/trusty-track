/**
 * Race Control on a phone (#782).
 *
 * The Roster, Standings and System Settings pages all collapse cleanly at a
 * 390 px (iPhone-class) viewport. Race Control's Schedule and Race tabs did
 * not: neither had a `@media` rule, so an un-wrapped flex header and a
 * content-box element carrying both `width: 100%` and its own padding each
 * pushed the whole document wider than the viewport, and mobile browsers
 * shrink the page to fit rather than showing a horizontal scrollbar — which
 * is what "renders at half size" in the issue actually meant.
 *
 * These assert the *document* itself lays out to the viewport it is given
 * (`document.documentElement.scrollWidth`), not just that an individual
 * element looks right — a single wide element anywhere on the page inflates
 * the whole document's width and re-triggers the shrink-to-fit, so the
 * end-to-end check is the one that matters.
 */

import { expect, test } from '@playwright/test';

import { createSchedule, ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

test('the Schedule tab lays out to a 390px viewport, with Add Round reachable and lane columns scrollable (#782)', async ({
    page,
}) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, 'Mobile Schedule Layout ' + Date.now());
    // A championship round too — its own header row (Pick by hand / Regenerate /
    // Delete) is the widest button group on the page, and the one most likely to
    // force the document wider if it stops wrapping.
    await createSchedule(page, raceId, { name: 'Finals', numTopRacers: 3 });
    await ensureConfigured(page);

    await page.goto(`/race/${raceId}/control`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Rounds Scheduled')).toBeVisible();

    // The document must not be wider than the viewport it was given. A couple
    // of pixels of slack for scrollbar rounding, not for a real overflow.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // Add Round must be fully on screen, not clipped by the viewport edge.
    const addRoundBox = await page.getByRole('button', { name: 'Add Round' }).boundingBox();
    expect(addRoundBox).not.toBeNull();
    expect(addRoundBox!.x + addRoundBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    // The heat table is wider than a phone screen — laned tables always will
    // be — so it must carry its own horizontal scroll container rather than
    // forcing the page itself to overflow, and the lane 4 column must be
    // reachable through it.
    const lane4Header = page.getByRole('columnheader', { name: 'Lane 4' }).first();
    await expect(lane4Header).toBeAttached();
    const scrollInfo = await lane4Header.evaluate((el) => {
        let node: HTMLElement | null = el as HTMLElement;
        while (node) {
            const cs = getComputedStyle(node);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
                return { found: true, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
            }
            node = node.parentElement;
        }
        return { found: false, scrollWidth: 0, clientWidth: 0 };
    });
    expect(scrollInfo.found).toBe(true);
    expect(scrollInfo.clientWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);
    await lane4Header.scrollIntoViewIfNeeded();
    await expect(lane4Header).toBeInViewport();
});

test('the Race tab lays out to a 390px viewport (#782)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, 'Mobile Race Layout ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    await page.goto(`/race/${raceId}/control/race`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Heat 1')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);
});
