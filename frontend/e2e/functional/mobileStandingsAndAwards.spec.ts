/**
 * Standings and Awards on a phone (#950).
 *
 * Filed from the absence of any responsive rule for five surfaces, without
 * running the app first. Checking each one at 390px (phone) and 768px
 * (tablet) found only two of the five actually broken:
 *
 * - Standings' seven-column table had no `overflow-x` wrapper — its outer
 *   card used `overflow: 'hidden'`, so at phone width the table's own
 *   intrinsic width (wider than the card) was cropped rather than scrolled,
 *   and the Heats and score columns were entirely unreachable.
 * - The Awards row (reorder arrows, artwork, name, recipient, edit, delete)
 *   had no `flexWrap`, so `minWidth: 0` on the name block let it shrink to
 *   nothing at phone width — every word of a long award name wrapped onto
 *   its own line — while Edit and Delete were pushed past the viewport edge.
 *
 * Race Control's header, the Schedule tab's per-round header (already fixed
 * by #782/#914 — see `mobileRaceControl.spec.ts`) and the Displays panel
 * rows (already `flexWrap: 'wrap'`) were all found intact at both widths and
 * are deliberately not touched here.
 */

import { expect, test } from '@playwright/test';

import {
    createSchedule,
    ensureConfigured,
    gql,
    readHeats,
    recordRound,
    seedRace,
} from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

test('the Standings table scrolls horizontally on a 390px phone instead of clipping (#950)', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Mobile Standings Layout ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    // Real results, so the table actually renders rather than the empty state.
    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/standings`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('columnheader', { name: 'Rank' })).toBeVisible();

    // The document itself must not be forced wider by the table.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // The table is wider than the phone at its own column widths, so its
    // immediate wrapper must carry a horizontal scroll container — the
    // column headers are attached to the DOM but scrolled out of view
    // rather than clipped with nothing to reach them.
    const table = page.locator('table').first();
    const scoreHeader = page.getByRole('columnheader', { name: /Avg Time|Points/ });
    await expect(scoreHeader).toBeAttached();

    const scrollInfo = await table.evaluate((el) => {
        const wrapper = el.parentElement as HTMLElement;
        const cs = getComputedStyle(wrapper);
        return {
            overflowX: cs.overflowX,
            scrollWidth: wrapper.scrollWidth,
            clientWidth: wrapper.clientWidth,
        };
    });
    expect(['auto', 'scroll']).toContain(scrollInfo.overflowX);
    expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);

    // Scrolling the wrapper reaches the score column that the fixed layout
    // (viewport width alone) does not show.
    await scoreHeader.scrollIntoViewIfNeeded();
    await expect(scoreHeader).toBeInViewport();
});

test('an Awards row wraps rather than overflowing a 390px phone (#950)', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Mobile Awards Layout ' + Date.now());
    await ensureConfigured(page);

    await gql(
        page,
        `mutation($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        {
            raceId,
            award: {
                name: 'Fastest Car In The Whole Pack This Year',
                kind: 'SPEED',
                source: 'ALL',
                place: 1,
            },
        },
    );

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/awards`);
    await page.waitForLoadState('networkidle');
    const awardName = page.getByText('Fastest Car In The Whole Pack This Year');
    await expect(awardName).toBeVisible();

    // The whole document must lay out to the phone viewport — an unwrapped
    // row used to push it wider, which mobile browsers answer by shrinking
    // the entire page to fit rather than showing a scrollbar.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // Edit and Delete must still be reachable, fully inside the viewport,
    // rather than pushed off the right edge by an unshrinkable name column.
    const editBtn = page.getByRole('button', {
        name: 'Edit Fastest Car In The Whole Pack This Year',
    });
    const editBox = await editBtn.boundingBox();
    expect(editBox).not.toBeNull();
    expect(editBox!.x + editBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

    const deleteBtn = page.getByRole('button', {
        name: 'Delete Fastest Car In The Whole Pack This Year',
    });
    const deleteBox = await deleteBtn.boundingBox();
    expect(deleteBox).not.toBeNull();
    expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
});
