/**
 * The activity timeline (#219).
 *
 * The rules are unit-tested on both sides. What only a real backend shows is
 * that the *seams fire*: the audit extension wraps the role policy in the
 * right order, the timer's own heat results reach the log even though they are
 * not a mutation, and a PIN never lands in a column somebody can read.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, readRounds, seedRace } from './support';

test('it records what the operator did, newest first', async ({ page }) => {
    await ensureConfigured(page);
    await seedRace(page, 'Activity Recorded Race');

    // Not scoped to this race: `_race_id_from` (backend/api/auth.py) only
    // reads an argument actually named `raceId`/`race_id` at the top level of
    // a mutation, by design — it does not open a nested input object or chase
    // a result back to its race, which would cost a query per mutation. Both
    // `createRace` (the id does not exist until the resolver returns) and
    // `createRacer`/`checkInRacer` (the race id, where present at all, is
    // nested inside `RacerInput` or absent entirely) therefore write their
    // audit entries with no `raceId`, and a page filtered to this race would
    // never show them — not a stale filter, just entries the query never
    // scoped to begin with.
    //
    // The unscoped log still proves "newest first": the backend always reads
    // it back with `order_by(AuditEntry.id.desc())` regardless of any race
    // filter, so seeding this race still leaves several entries — createRace
    // and a run of createRacer/checkInRacer calls — whose ids are known to be
    // ascending in the order they were written. A component that rendered the
    // server's rows in reverse, or in whatever order the network happened to
    // deliver them, fails the ordering check below even though other specs
    // are writing to the same shared log at the same time.
    await page.goto('/activity');

    await expect(page.getByText('Created a race').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Activity Recorded Race/).first()).toBeVisible();

    const entryIds = (
        await page.locator('[data-testid^="activity-entry-"]').evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-testid')),
        )
    ).map((testId) => parseInt(testId!.replace('activity-entry-', ''), 10));

    // Seeding six racers (each a create plus a check-in) leaves well more than
    // one entry to order — enough that a page rendering them in reverse, or in
    // whatever order the network happened to deliver them, would fail this.
    expect(entryIds.length).toBeGreaterThan(1);
    const sortedDescending = [...entryIds].sort((a, b) => b - a);
    expect(entryIds).toEqual(sortedDescending);
});

test('a heat the timer records reaches the log', async ({ page }) => {
    // The route a mutation-only log would miss entirely, and the reason the
    // source argument is mandatory.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Activity Timer Result Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    // Enabled, not merely visible (#1157) — the button is always in the
    // DOM now, disabled until the heat has a result, so `toBeVisible()`
    // alone would resolve before the timer's result actually lands and let
    // this navigate away too soon.
    await expect(page.getByTestId('next-heat-button')).toBeEnabled({
        timeout: 30000,
    });

    await page.goto(`/activity?race=${raceId}`);

    await expect(page.getByText('Heat result recorded by the timer').first()).toBeVisible({
        timeout: 15000,
    });
    // And it is attributed to the app rather than to a person: nobody was at a
    // keyboard when the device reported.
    await expect(page.getByText(/Trusty Track/).first()).toBeVisible();
});

test('a result typed in by hand is told apart from the timer’s', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Activity Hand Result Race');
    await createSchedule(page, raceId);

    const heats = await gql<{ race: { heats: { id: number; lanes: { lane: number; racerId: number | null }[] }[] } }>(
        page,
        `query ActivityHeats($id: Int!) {
            race(raceId: $id) { heats { id lanes { lane racerId } } }
        }`,
        { id: raceId },
    );
    const heat = heats.race.heats[0];
    await gql(
        page,
        `mutation ActivityRecord($heatId: Int!, $lanes: [HeatLaneInput!]!) {
            updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
        }`,
        {
            heatId: heat.id,
            lanes: heat.lanes
                .filter((l) => l.racerId !== null)
                .map((l, index) => ({ lane: l.lane, racerId: l.racerId, time: 3 + index, place: index + 1 })),
        },
    );
    expect(racers.length).toBeGreaterThan(0);

    await page.goto(`/activity?race=${raceId}`);

    await expect(page.getByText('Heat result entered by hand').first()).toBeVisible({
        timeout: 15000,
    });
});

test('Live brings in a heat result the timer just recorded, with no Refresh click', async ({
    page,
    context,
}) => {
    // The one scenario that exercises both audit seams *and* the socket
    // together (#1078): a query refetching itself off `race_state:{raceId}`
    // rather than a subscription is why the log stays a query at all
    // (`.claude/rules/auth-and-demo.md`'s "A query, not a subscription"), and
    // nothing short of a real backend and a real browser proves the wiring
    // between the timer's own result path and that channel actually reaches
    // a second, unrefreshed tab.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Activity Live Race');
    await createSchedule(page, raceId);

    // The operator's second screen: Activity, filtered to this race, Live on.
    await page.goto(`/activity?race=${raceId}`);
    await page.getByTestId('live-activity').click();
    await expect(page.getByTestId('live-activity')).toBeChecked();
    await expect(page.getByText('Heat result recorded by the timer')).toHaveCount(0);

    // A second tab runs the race — the same fake-timer seam the earlier test
    // in this file drives, just from a tab that never touches Activity.
    const control = await context.newPage();
    await control.goto(`/race/${raceId}/control/race`);
    await expect(control.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await control.getByRole('button', { name: 'Start Timer' }).click();
    await control.getByRole('button', { name: 'Finish Heat' }).click();
    // Same reasoning as above — enabled, not merely visible.
    await expect(control.getByTestId('next-heat-button')).toBeEnabled({
        timeout: 30000,
    });

    // No `refresh-activity` click on `page` anywhere above — Live is what is
    // supposed to bring this entry in on its own.
    await expect(page.getByText('Heat result recorded by the timer').first()).toBeVisible({
        timeout: 15000,
    });
});

// The remaining two claims — that a device without the operator PIN is refused
// the log, and that a PIN never reaches a column — are backend tests
// (`test_audit_log.py`). Setting a PIN here would lock this shared backend for
// every spec that runs after, and a failed unlock would take the suite with it.

// The category chips and the Noteworthy toggle (#1253). The rules — which
// action lands in which category, and what counts as noteworthy — are
// unit-tested on both ends (`test_audit_categories.py`, `activityCategories
// .test.ts`, `test_audit_log.py`'s own filter suite). What only a real
// backend and a real browser show is that the *server-side* filter and the
// client's chip row agree: a chip narrows the actual timeline on screen, not
// just what a unit test believes a lookup table says.

// None of the four specs below filter by race (`?race=`). `createRacer`,
// `checkInRacer` and `deleteRound` all take their race id nested inside an
// input object or resolve it from a *different* id (`roundId`) rather than a
// top-level `raceId`/`race_id` argument, and `backend/api/auth.py`'s
// `_race_id_from` — the audit wrapper's own extraction — only ever reads a
// top-level one (see this file's very first test for the identical reason).
// So their audit entries carry no `raceId`, and a page filtered to one race
// would never show them at all — that would test the race filter, not the
// category one. The category/Noteworthy filters are server-side over the
// *whole* log regardless of race, so the plain `/activity` timeline is the
// right screen for all four.

test('the default view is unaffected by the chips — every category is selected out of the box', async ({
    page,
}) => {
    await ensureConfigured(page);
    await seedRace(page, 'Activity Categories Default Race');

    await page.goto('/activity');

    for (const testId of [
        'activity-category-results',
        'activity-category-schedule',
        'activity-category-roster',
        'activity-category-awards',
        'activity-category-displays',
        'activity-category-setup',
    ]) {
        await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByTestId('activity-noteworthy-only')).not.toBeChecked();
    // Roster entries (racer creates/check-ins) are visible with nothing
    // narrowed — the same thing every earlier test in this file already
    // relies on.
    await expect(page.getByText('Added a racer').first()).toBeVisible({ timeout: 15000 });
});

test('deselecting every chip but one narrows the timeline to that category', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Activity Categories Filter Race');
    // A SCHEDULE-category action ("Built a schedule"), alongside `seedRace`'s
    // own ROSTER-category ones ("Added a racer" / "Checked in a racer").
    await createSchedule(page, raceId);

    await page.goto('/activity');
    await expect(page.getByText('Added a racer').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Built a schedule').first()).toBeVisible();

    // Deselect every chip except Roster & check-in.
    for (const testId of [
        'activity-category-results',
        'activity-category-schedule',
        'activity-category-awards',
        'activity-category-displays',
        'activity-category-setup',
    ]) {
        await page.getByTestId(testId).click();
    }

    await expect(page.getByText('Added a racer').first()).toBeVisible();
    // Filtered server-side, over the whole log — not just this test's own
    // entries, which is exactly the point: nothing categorised SCHEDULE can
    // be on the page at all once that chip is off.
    await expect(page.getByText('Built a schedule')).toHaveCount(0);
});

test('Noteworthy only keeps a destructive action and hides an ordinary check-in', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Activity Noteworthy Race');
    await createSchedule(page, raceId);
    const [round] = await readRounds(page, raceId);

    // `deleteRound` is in `NOTEWORTHY_ACTIONS` regardless of outcome — the
    // destructive-action half of "Noteworthy", as opposed to the
    // not-`OK`-outcome half `test_audit_log.py` already covers.
    await gql(page, `mutation DeleteRound($id: Int!) { deleteRound(roundId: $id) }`, {
        id: round.id,
    });

    await page.goto('/activity');
    await expect(page.getByText('Deleted a round').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Checked in a racer').first()).toBeVisible();

    await page.getByTestId('activity-noteworthy-only').click();

    await expect(page.getByText('Deleted a round').first()).toBeVisible();
    // Every `checkInRacer` entry anywhere in the log is `OK` and not in
    // `NOTEWORTHY_ACTIONS`, so the filter removes all of them — server-side,
    // not just the ones this test wrote.
    await expect(page.getByText('Checked in a racer')).toHaveCount(0);
});

test('Load older stays within an active category filter', async ({ page }) => {
    test.setTimeout(180000);
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Activity Category Paging Race');
    // `ActivityLog.tsx`'s own page size is 200 — enough more ROSTER entries
    // (on top of whatever ROSTER entries the rest of this file already
    // wrote) to fill a first filtered page outright, so a second page under
    // the same filter is reachable at all. One GraphQL call each, through
    // `page.request` rather than the UI, the same as every other seeding
    // helper in this file.
    for (let i = 0; i < 200; i++) {
        await gql(page, `mutation ExtraRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`, {
            racer: { raceId, firstName: 'Extra', lastName: `Racer ${i}` },
        });
    }
    // The newest entry of all by the time this loads the page — a SCHEDULE
    // one. A server that filtered client-side over an already-paged (rather
    // than already-filtered) query would either surface it or come up short
    // of a full 200-row first page; either way `load-older-activity` is the
    // tell, since `hasAnotherPage` only appears once a fetched page is
    // genuinely full.
    await createSchedule(page, raceId);

    await page.goto('/activity');
    for (const testId of [
        'activity-category-results',
        'activity-category-schedule',
        'activity-category-awards',
        'activity-category-displays',
        'activity-category-setup',
    ]) {
        await page.getByTestId(testId).click();
    }
    await expect(page.getByText('Added a racer').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Built a schedule')).toHaveCount(0);
    await expect(page.getByTestId('load-older-activity')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('load-older-activity').click();

    // Still ROSTER-only after paging — never "Built a schedule", which a
    // page-then-filter bug would let through the moment paging reached it.
    await expect(page.getByText('Added a racer').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Built a schedule')).toHaveCount(0);
});
