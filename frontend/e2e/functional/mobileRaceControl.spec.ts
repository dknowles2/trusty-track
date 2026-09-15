/**
 * Race Control on a phone (#782, #1139).
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
 *
 * The Schedule tab's own check used to assert the *table*'s own horizontal
 * scroll container reached lane 4 — the fix #782 shipped for a heat table
 * that is always wider than a phone. #1139 replaced that table with one
 * card per heat under 600px (`ScheduleManagement.tsx`'s `isNarrow` branch),
 * which needs no scroll container at all: every lane is directly on
 * screen. `mobileSchedule.spec.ts` is the fuller regression test for that
 * fix; this spec's own job is narrower — the whole-document layout #782 was
 * about — so it now checks lane 4 is simply visible rather than checking
 * for a scroll container that no longer exists.
 */

import { expect, test } from '@playwright/test';

import { createSchedule, ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

test('the Schedule tab lays out to a 390px viewport, with Add Round and every lane reachable (#782, #1139)', async ({
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

    // Under 600px each round renders as one card per heat rather than a
    // table (#1139) — no table at all, and lane 4 sits directly on screen
    // with nothing to scroll to reach it.
    await expect(page.getByRole('table')).toHaveCount(0);
    const lane4Line = page.getByText('L4', { exact: true }).first();
    await expect(lane4Line).toBeVisible();
    const lane4Box = await lane4Line.boundingBox();
    expect(lane4Box).not.toBeNull();
    expect(lane4Box!.x).toBeGreaterThanOrEqual(0);
    expect(lane4Box!.x + lane4Box!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
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
