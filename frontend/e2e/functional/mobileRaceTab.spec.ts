/**
 * The Race tab's lane rows on a phone (issue #1008).
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
 */

import { expect, Locator, test } from '@playwright/test';

import { createSchedule, ensureConfigured, gql, readHeats, recordRound, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

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
    if (await currentRow.count()) {
        const rowBox = await currentRow.boundingBox();
        expect(rowBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
        await assertVisibleGap(currentRow, '.race-execution-racer-name', '.race-execution-time');
    }

    // The "Previous Heats" list — this is where the report's screenshot was
    // actually taken, and she may appear in more than one of them.
    const previousRows = page.locator('.previous-heat-lane-row').filter({ hasText: 'Konstantinopoulos' });
    const previousCount = await previousRows.count();
    for (let i = 0; i < previousCount; i++) {
        const row = previousRows.nth(i);
        const rowBox = await row.boundingBox();
        expect(rowBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
        await assertVisibleGap(row, '.previous-heat-racer-name', '.previous-heat-time');
    }

    // At least one of the two surfaces must actually have been checked, or
    // this test would pass having asserted nothing at all.
    expect((await currentRow.count()) + previousCount).toBeGreaterThan(0);
});
