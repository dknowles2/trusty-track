/**
 * The activity timeline (#219).
 *
 * The rules are unit-tested on both sides. What only a real backend shows is
 * that the *seams fire*: the audit extension wraps the role policy in the
 * right order, the timer's own heat results reach the log even though they are
 * not a mutation, and a PIN never lands in a column somebody can read.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, seedRace } from './support';

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
