/**
 * "How heats are built" — the round wizard's scheduling-algorithm choice
 * (#1090, part D), driven through the served page rather than only through
 * `RoundWizard.test.tsx`'s mocked `useQuery`. This is the one place that
 * proves the whole round trip: the wizard's disclosure reads real
 * `schedulingAlgorithms` data for this race's actual field and track, a
 * chosen algorithm reaches `createRoundWizard`, and the schedule the
 * backend actually built has the algorithm's own guarantee — not just that
 * the mutation was called with the right variables.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- schedulingAlgorithmChoice.spec.ts
 */

import { test, expect } from '@playwright/test';
import { gql, seedRace, readHeats, readRounds } from './support';

async function openWizardAndExpandChoice(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /Start Round Creation Wizard/i }).click();
    await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeVisible();
    await page.getByText('How heats are built').click();
}

test('choosing Lane rotation builds a schedule where a car advances one lane at a time', async ({
    page,
}) => {
    const { raceId, laneCount } = await seedRace(page, 'Scheduling Algorithm Rotation');

    await page.goto(`/race/${raceId}/control/schedule`);
    await openWizardAndExpandChoice(page);

    await page.getByLabel('Lane rotation').check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Generate schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeHidden({
        timeout: 30000,
    });

    const heats = await readHeats(page, raceId);
    expect(heats.length).toBeGreaterThan(0);

    // `generate_rotation`'s own guarantee: for any two heats numbered `h`
    // and `h + 1` a car appears in, its lane advances by exactly one, mod
    // the window width (`min(racerCount, laneCount)` — 6 racers on a
    // 4-lane track, so 4; `.claude/rules/scheduling.md`'s "Heat scheduling
    // (PPC)" / `test_domain_scheduling.py`'s own rotation property).
    const windowWidth = Math.min(6, laneCount);
    const byCarThenHeat = new Map<number, Map<number, number>>();
    for (const heat of heats) {
        for (const lane of heat.lanes) {
            if (lane.racerId == null) continue;
            const perCar = byCarThenHeat.get(lane.racerId) ?? new Map<number, number>();
            perCar.set(heat.heatNumber, lane.lane);
            byCarThenHeat.set(lane.racerId, perCar);
        }
    }

    let consecutivePairsChecked = 0;
    for (const perCar of byCarThenHeat.values()) {
        for (const [heatNumber, lane] of perCar) {
            const nextLane = perCar.get(heatNumber + 1);
            if (nextLane === undefined) continue;
            consecutivePairsChecked += 1;
            const expectedNextLane = (lane % windowWidth) + 1;
            expect(nextLane).toBe(expectedNextLane);
        }
    }
    // The property above is checked, not merely stated — this guards
    // against a schedule shaped so no car ever appears in two consecutive
    // heat numbers, which would make every assertion above vacuous.
    expect(consecutivePairsChecked).toBeGreaterThan(0);
});

test('choosing Perfect-N at a covered shape (5 racers, 4 lanes) builds the chart\'s own heat count', async ({
    page,
}) => {
    const { raceId, laneCount, racers } = await seedRace(page, 'Scheduling Algorithm Perfect N');
    expect(laneCount).toBe(4);

    // `perfect_n_tables.CHARTS` has an entry for 5 cars on 4 lanes
    // (`P5-4 (3)`, the same shape `docs/scheduling-algorithms.md`'s own
    // example uses) but not for 6 — withdraw one racer so the field this
    // round actually schedules is the covered shape.
    await gql(
        page,
        `mutation Withdraw($id: Int!) {
            checkInRacer(id: $id, passedInspection: false, weight: null) { id }
        }`,
        { id: racers[5].id },
    );

    await page.goto(`/race/${raceId}/control/schedule`);
    await openWizardAndExpandChoice(page);

    const perfectN = page.getByLabel('Perfect-N chart');
    await expect(perfectN).toBeEnabled();
    await perfectN.check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Generate schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeHidden({
        timeout: 30000,
    });

    // The wizard's default championship round ("Grand Finals") is still
    // part of this batch — filter to the general round's own heats, the
    // same way any reader distinguishing a schedule from a placeholder
    // final has to.
    const rounds = await readRounds(page, raceId);
    const generalRound = rounds.find((r) => r.advancementSource === null);
    if (!generalRound) throw new Error('createRoundWizard did not build a general round');
    const heats = await readHeats(page, raceId);
    const generalHeats = heats.filter((h) => h.roundId === generalRound.id);
    expect(generalHeats).toHaveLength(5);

    // The Schedule tab's own muted label (`ScheduleManagement.tsx`'s
    // `SCHEDULING_ALGORITHM_LABEL`) — named only because it isn't PPC.
    await expect(page.getByText('Perfect-N', { exact: true })).toBeVisible();
});

test('an uncovered shape greys the Perfect-N option with a reason', async ({ page }) => {
    // The default seeded race: 6 racers on a 4-lane track. `perfect_n_
    // tables.CHARTS[(4, _)]` covers 4, 5, 7, 9, 10, 13, 19, 37 — not 6 — so
    // this is genuinely uncovered, not a special-cased shape.
    const { raceId } = await seedRace(page, 'Scheduling Algorithm Uncovered');

    await page.goto(`/race/${raceId}/control/schedule`);
    await openWizardAndExpandChoice(page);

    const perfectN = page.getByLabel('Perfect-N chart');
    await expect(perfectN).toBeDisabled();
    await expect(page.getByText(/No Perfect-N chart is published for 6 cars on 4 lanes/)).toBeVisible();
});
