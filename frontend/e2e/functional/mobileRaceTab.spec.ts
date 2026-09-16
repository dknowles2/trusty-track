/**
 * The Race tab's lane rows on a phone (issue #1008, and #1140/#1152's
 * follow-on redesign).
 *
 * Reported as a racer's name running straight into the time with no visible
 * space — "Mae Jemison3.552s" — under 400px. The "Previous Heats" list
 * (`RaceControl.tsx`) is where it actually lived: each row is a CSS Grid
 * item (the list itself is `display: grid`) holding a `display: flex` lane
 * row, and *both* levels default their automatic minimum size to their
 * content's own width unless told otherwise — the grid item because it had
 * no `minWidth: 0` of its own, and (once that is fixed) the name `<span>`
 * inside it for the identical reason. With a long enough name, the grid
 * item's track grew to fit the *unwrapped* name rather than confining it to
 * the phone's own width, which pushed the whole row past the viewport with
 * nothing to say a piece of it was now off-screen — reproduced directly
 * below by pinning `rowWidth` and the document's own `scrollWidth` before
 * trusting the narrower "is there a gap" measurement, which a short name
 * (the report's own "Mae Jemison") never puts under enough pressure to fail
 * on its own. `mobileStandingsAndAwards.spec.ts` already established 390px
 * as this suite's stand-in for "a phone", so this uses the same viewport
 * rather than inventing a second one.
 *
 * #1140/#1152 changed the shape rather than just the numbers: the current
 * heat's own `.race-execution-lane-row` is two lines under 600px now (name
 * on its own line, time and place on the next), so the horizontal
 * name/time gap this file used to check for that row no longer applies —
 * there is nothing to the right of the name to leave a gap from. What
 * still has to hold is that the name is never truncated to an ellipsis;
 * `scrollWidth <= clientWidth` on the name element is that check
 * regardless of which line it sits on. Previous Heats' own lane rows are
 * unchanged in shape (still one line, expanding into view on tap rather
 * than always being on screen), so the original horizontal-gap check still
 * applies once a row is opened.
 */

import { expect, Locator, test } from '@playwright/test';

import { createSchedule, ensureConfigured, gql, readHeats, recordRound, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

// `hasTouch` is what makes Chromium report `(pointer: coarse)` and
// `(hover: none)` — the media query `index.css` hides every `<kbd>` hint
// behind (#1140). The functional project otherwise runs Desktop Chrome
// (`playwright.config.ts`), so without this every test in this file would
// be exercising the desktop, `pointer: fine` half of that rule regardless
// of the narrow `viewport` set below.
test.use({ hasTouch: true });

/**
 * The row is left-to-right and the two elements are siblings in the same
 * flex row, so a genuine gap is the time box starting meaningfully to the
 * right of where the name box ends — not merely "not overlapping", which a
 * zero-width gap would also satisfy.
 */
async function assertVisibleGap(row: Locator, nameSelector: string, timeSelector: string) {
    const nameBox = await row.locator(nameSelector).boundingBox();
    const timeBox = await row.locator(timeSelector).boundingBox();
    expect(nameBox).not.toBeNull();
    expect(timeBox).not.toBeNull();
    const gap = timeBox!.x - (nameBox!.x + nameBox!.width);
    expect(gap).toBeGreaterThanOrEqual(4);
}

/** No ellipsis: the element's own scrollable content fits the box it renders in. */
async function assertNameNotTruncated(nameLocator: Locator) {
    const { scrollWidth, clientWidth } = await nameLocator.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('a lane row keeps a visible gap between the racer name and the time on a 390px phone (#1008)', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Mobile Race Tab Layout ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    // Long enough that it cannot fit unwrapped in the space this row has on
    // a 390px phone — a short two-word name like the report's own "Mae
    // Jemison" fits comfortably either way and would pass whether or not
    // the fix is in place, which is not a regression test.
    const first = racers[0];
    await gql(
        page,
        `mutation RenameForMobileLayout($id: Int!, $racer: RacerInput!) {
            updateRacer(id: $id, racer: $racer) { id }
        }`,
        {
            id: first.id,
            racer: {
                firstName: 'Alexandria',
                lastName: 'Konstantinopoulos-Featherstonehaugh',
                carNumber: first.carNumber,
                // `RacerInput.carPassedInspection` defaults to `false`
                // rather than "leave alone" (unlike `RaceUpdateInput`'s own
                // fields) — omitting it here un-checks the racer, which
                // withdraws them from the not-yet-raced schedule entirely.
                carPassedInspection: true,
            },
        },
    );

    // Real times, so the row renders "3.0Xs" rather than the "--" fallback —
    // the geometry this test checks is the same either way, but this is
    // what the report actually saw.
    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/control/race`);
    await page.waitForLoadState('networkidle');

    // The document itself must not be forced wider by a long name — the
    // observable shape of the underlying bug (a grid item with no
    // `minWidth: 0` grows its track to fit unwrapped content rather than
    // confining it to the phone's own width).
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // PPC seeds lane 1 with every racer once each, filling the rest
    // greedily (`.claude/rules/scheduling.md`), so which heat this racer
    // lands in as the "current" (last, all-recorded) one is not something
    // this test controls — check whichever surface she actually appears
    // on, current or previous, rather than assume either.
    const currentRow = page.locator('.race-execution-lane-row').filter({ hasText: 'Konstantinopoulos' });
    let checked = 0;
    if (await currentRow.count()) {
        const rowBox = await currentRow.boundingBox();
        expect(rowBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
        // Two lines under 600px now (#1140) — name and time no longer sit
        // side by side, so there is no horizontal gap to check here; what
        // still has to hold is that the name itself is never ellipsised.
        await assertNameNotTruncated(currentRow.locator('.race-execution-racer-name'));
        checked++;
    }

    // The "Previous Heats" list — this is where the report's screenshot was
    // actually taken, and she may appear in more than one of them. Rows
    // collapse to one summary line per heat under 600px now (#1152),
    // expanding on tap to the full lane list this test needs — so every
    // matching summary row is opened first.
    const summaryRows = page.locator('.previous-heat-row').filter({ hasText: /Konstantinopoulos/ });
    const summaryCount = await summaryRows.count();
    for (let i = 0; i < summaryCount; i++) {
        await summaryRows.nth(i).locator('.previous-heat-summary, span', { hasText: /Heat \d+/ }).first().click();
    }
    const previousRows = page.locator('.previous-heat-lane-row').filter({ hasText: 'Konstantinopoulos' });
    const previousCount = await previousRows.count();
    for (let i = 0; i < previousCount; i++) {
        const row = previousRows.nth(i);
        const rowBox = await row.boundingBox();
        expect(rowBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
        await assertVisibleGap(row, '.previous-heat-racer-name', '.previous-heat-time');
        checked++;
    }

    // At least one of the two surfaces must actually have been checked, or
    // this test would pass having asserted nothing at all.
    expect(checked).toBeGreaterThan(0);
});

test('no keyboard hint renders on a 390px phone (#1140)', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Mobile No Kbd ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('race-execution-action-row')).toBeVisible({ timeout: 30000 });

    // The hint is hidden by `@media (pointer: coarse)` in `index.css` — see
    // this file's own `test.use({ hasTouch: true })` above for why that
    // query matches here at all. `display: none` leaves the element in the
    // DOM (so `toHaveCount(0)` would not catch a regression here — the
    // element is still there, just not painted), which is what
    // `toBeHidden()` checks instead.
    const kbds = page.locator('kbd');
    const count = await kbds.count();
    expect(count).toBeGreaterThan(0); // Something to actually hide — Edit's, at least.
    for (let i = 0; i < count; i++) {
        await expect(kbds.nth(i)).toBeHidden();
    }
});

test('a 4-lane, 12-heat round with 6 heats recorded fits in far less than 3,232px on a 390px phone (#1152)', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Mobile Tall Page ' + Date.now());

    // Twelve racers on a 4-lane track: PPC seeds lane 1 with every racer
    // once each (`.claude/rules/scheduling.md`), so a General round with
    // no championship is twelve heats.
    const extraRacers = [...racers];
    for (let i = 0; i < 6; i++) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation SeedExtraRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
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
            `mutation SeedExtraCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
        extraRacers.push({ id: created.createRacer.id, firstName: `Extra${i}`, lastName: 'Racer', carNumber: 100 + i });
    }

    await createSchedule(page, raceId);
    const heats = await readHeats(page, raceId);
    expect(heats.length).toBe(12);

    // Six recorded, six still to run — a mid-round page, not a finished one.
    await recordRound(page, heats.slice(0, 6), extraRacers);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/control/race`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Previous Heats')).toBeVisible({ timeout: 30000 });

    const { scrollWidth, scrollHeight } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
    }));
    // Never wider than the viewport itself.
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    // Was 3,232px before #1152's collapse of On Deck (60px avatars down to
    // 32px) and Previous Heats (one summary row per heat instead of every
    // lane of every heat) — measured at ~2,230px after this change alone, a
    // real ~30% reduction but short of the issue's own illustrative "under
    // 1,600px". This screen's page also carries #1148's chrome above the
    // card (the H1, tab strip, Edit race, the roster), which is explicitly
    // out of scope for this change and is not touched here — closing the
    // rest of the gap is that issue's job, not this one's. 2,500 leaves
    // headroom without passing on a regression that gives back a
    // meaningful slice of what this fixed.
    expect(scrollHeight).toBeLessThan(2500);
});
