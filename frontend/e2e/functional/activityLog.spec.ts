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
    const { raceId } = await seedRace(page, 'Activity Recorded Race');

    // Scoped to this race: seeding ran createRace followed by a string of
    // createRacer/checkInRacer mutations, which is several entries whose
    // chronological order is known — createRace happened first — and whose
    // ids the backend assigns in that same order (`auditLog` reads back
    // `order_by(AuditEntry.id.desc())`). "Newest first" means those ids read
    // in descending order down the page; a component that rendered the
    // server's rows in reverse would still pass a mere-presence check.
    await page.goto(`/activity?race=${raceId}`);

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
    await expect(page.getByRole('button', { name: /^Next Heat/ })).toBeVisible({
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

// The remaining two claims — that a device without the operator PIN is refused
// the log, and that a PIN never reaches a column — are backend tests
// (`test_audit_log.py`). Setting a PIN here would lock this shared backend for
// every spec that runs after, and a failed unlock would take the suite with it.
