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

/**
 * #950's own test above seeds one award with no rule and no recipient —
 * the empty-state row. #996 is the seam it left: a *populated* row, with a
 * real recipient name and a real description, both at once. `flexWrap`
 * alone (#950's fix) was not enough there — `minWidth: 0` on the name
 * block let it shrink to a sliver instead of wrapping onto its own line,
 * so a long description went one word per line and a recipient's name
 * rendered close enough to visually overlap it.
 */
test('an Awards row stacks its name, description, recipient and controls onto separate lines rather than overlapping on a 390px phone, once awards are decided (#996)', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Mobile Awards Populated ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    // Real results, so a SPEED award actually resolves to a racer's full
    // name rather than "Not decided by the racing yet" — the exact
    // "recipient text overlapping the description" shape #996 reported.
    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    // A row with no rule at all — the exact "Not set up — this award
    // cannot be won" text #996 found wrapping one word per line.
    await gql(
        page,
        `mutation($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        {
            raceId,
            award: {
                name: 'Judges’ Special Recognition For Outstanding Craftsmanship',
                kind: 'SPECIAL',
                votable: false,
            },
        },
    );

    // Two decided SPEED awards, so a recipient's real name renders.
    await gql(
        page,
        `mutation($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Fastest Overall', kind: 'SPEED', source: 'ALL', place: 1 } },
    );
    await gql(
        page,
        `mutation($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Second Fastest', kind: 'SPEED', source: 'ALL', place: 2 } },
    );

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/awards`);
    await page.waitForLoadState('networkidle');

    // Wait for the recipient to resolve — car #1 (Ada Ant) is the fastest,
    // by `recordRound`'s own car-number-ascending rule.
    await expect(page.getByText('Ada Ant', { exact: false })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    const rows = page.locator('.award-row-main');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const boxes: { name: string; box: { x: number; y: number; width: number; height: number } }[] =
            [];
        for (const selector of [
            '.award-row-artwork',
            '.award-row-name-text',
            '.award-row-desc',
            '.award-row-recipient',
            '.award-row-edit',
            '.award-row-delete',
        ]) {
            const locator = row.locator(selector);
            if (await locator.count()) {
                const box = await locator.boundingBox();
                if (box) boxes.push({ name: selector, box });
            }
        }

        // Nothing in this row's content extends past the viewport edge.
        for (const { name, box } of boxes) {
            expect(
                box.x + box.width,
                `${name} in row ${i} extends past the 390px viewport`,
            ).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);
        }

        // The description and the recipient must each get real width, not
        // be squeezed toward zero — this is the check that actually catches
        // #996's failure and the pairwise-overlap check below does not.
        // `minWidth: 0` plus a flex row with no forced line breaks does not
        // paint two elements on top of each other in any way a bounding-box
        // comparison can see: the browser instead collapses the *box* of a
        // shrinkable flex item toward zero width while its overflowing text
        // still renders (default `overflow: visible`), stacking one word
        // per line inside a nominally ~1px-wide container. Two adjacent
        // collapsed boxes therefore never register as overlapping by
        // bounding rect, even though the room reports it looks that way.
        // Measured directly against a reverted `index.css`: the collapsed
        // width was under 21px on every one of these two elements, against
        // 292px once the fix's forced line breaks are in place.
        for (const selector of ['.award-row-desc', '.award-row-recipient']) {
            const box = boxes.find((b) => b.name === selector)?.box;
            if (!box) continue;
            expect(
                box.width,
                `${selector} in row ${i} has collapsed to near-zero width`,
            ).toBeGreaterThan(100);
        }

        // No two pieces of this row's content overlap each other — a
        // second-order check for the case where two boxes genuinely do
        // occupy the same rectangle (a different way #996's failure could
        // have shown up), kept alongside the width check above rather than
        // instead of it.
        for (let a = 0; a < boxes.length; a++) {
            for (let b = a + 1; b < boxes.length; b++) {
                const boxA = boxes[a].box;
                const boxB = boxes[b].box;
                const overlaps =
                    boxA.x < boxB.x + boxB.width &&
                    boxA.x + boxA.width > boxB.x &&
                    boxA.y < boxB.y + boxB.height &&
                    boxA.y + boxA.height > boxB.y;
                expect(overlaps, `${boxes[a].name} overlaps ${boxes[b].name} in row ${i}`).toBe(
                    false,
                );
            }
        }
    }
});
