/**
 * Settling a tie by racing it off, from the Standings page (#1017).
 *
 * The bug this covers sat at the seam between two individually-tested
 * features: `resolveTies`/`resolutionNote` (unit-tested against every
 * `Tiebreaker` method) and `RunOffControl` (unit-tested with a mocked
 * `useQuery`). Neither test drove a real tie through a real run-off and
 * looked at what the Standings page actually shows afterward — which is
 * exactly the gap a settled `RUN_OFF` fell into: `methodPhrase` never
 * learned the word for it, and the tied-cluster grouping that mounts
 * `RunOffControl` stopped finding the row the moment the run-off did its
 * job. Nothing in `frontend/e2e/functional/` drove a run-off before this.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- runOffStandings.spec.ts
 */

import { test, expect } from '@playwright/test';
import { gql, readHeats, seedRace, createSchedule, type Heat, type SeededRacer } from './support';

/**
 * Records every heat so Ada and Ben tie *exactly* for first, and nobody
 * else comes close.
 *
 * A plain "same time in every heat" does not work here: PPC does not
 * guarantee every racer runs the same number of heats, and `TIMED` scores
 * an *average* — two racers running a different number of heats at the
 * identical time are still tied mathematically, but summing the same
 * floating-point literal a different number of times is not guaranteed to
 * land on the identical average bit for bit. So only the heat(s) where
 * *both* Ada and Ben actually appear are given a real time (the same
 * literal, `3.100`); every other heat either of them appears in alone is
 * recorded with their own lane skipped, which excludes it from `TIMED`'s
 * average entirely (`domain/scoring.py`'s `_counted_values`) — so both end
 * up with the exact same list of counted values and the exact same average.
 */
async function recordWithExactTie(
    page: import('@playwright/test').Page,
    heats: Heat[],
    racers: SeededRacer[],
    tiedFirstName1: string,
    tiedFirstName2: string,
): Promise<void> {
    const tied1 = racers.find((r) => r.firstName === tiedFirstName1)!;
    const tied2 = racers.find((r) => r.firstName === tiedFirstName2)!;
    const carNumber = new Map(racers.map((r) => [r.id, r.carNumber]));

    for (const heat of heats) {
        const occupied = heat.lanes.filter((l) => l.racerId !== null);
        if (occupied.length === 0) continue;

        const hasBoth =
            occupied.some((l) => l.racerId === tied1.id) &&
            occupied.some((l) => l.racerId === tied2.id);

        const lanes = occupied.map((lane) => {
            if (lane.racerId === tied1.id || lane.racerId === tied2.id) {
                return hasBoth
                    ? { lane: lane.lane, racerId: lane.racerId, time: 3.1, place: null, skipped: false }
                    : { lane: lane.lane, racerId: lane.racerId, time: null, place: null, skipped: true };
            }
            // Everybody else: distinct, clearly slower times so nothing else
            // ties, and no filler ever collides with the tied pair's 3.1.
            return {
                lane: lane.lane,
                racerId: lane.racerId,
                time: 4.0 + carNumber.get(lane.racerId!)! / 100,
                place: null,
                skipped: false,
            };
        });

        await gql(
            page,
            `mutation RecordHeat($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes },
        );
    }
}

test('a settled run-off leaves its own note and its own times on the standings row', async ({ page }) => {
    const { raceId, racers } = await seedRace(page, 'Run Off Standings Seam');
    await createSchedule(page, raceId);
    const heats = await readHeats(page, raceId);

    // Ada and Ben tie exactly for first; everybody else is well behind.
    await recordWithExactTie(page, heats, racers, 'Ada', 'Ben');

    await page.goto(`/race/${raceId}/standings`);

    // Both share the top of the standings, with the button to settle it.
    await expect(page.getByText('Ada Ant')).toBeVisible();
    await expect(page.getByText('Ben Bear')).toBeVisible();
    const startButton = page.getByTestId('start-run-off-btn');
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(page.getByTestId('run-off-panel')).toBeVisible();

    // Settle it by hand — Ada wins the run-off.
    await page.getByLabel('Ada Ant').fill('3.050');
    await page.getByLabel('Ben Bear').fill('3.200');
    await page.getByRole('button', { name: 'Record result' }).click();

    // The tie splits apart and says why, on both rows (#1017's own headline
    // symptom: "medals with no word about why").
    await expect(page.getByText('1st, on a run-off')).toBeVisible();
    await expect(page.getByText('2nd, on a run-off')).toBeVisible();

    // The run-off's own record survives on the page — the control did not
    // simply disappear the moment it resolved the tie.
    const decided = page.getByTestId('run-off-recorded-times');
    await expect(decided).toBeVisible();
    await expect(decided).toContainText('Ada Ant');
    await expect(decided).toContainText('3.050s');
    await expect(decided).toContainText('Ben Bear');
    await expect(decided).toContainText('3.200s');

    // A correction is offered, not a dead end.
    await expect(page.getByTestId('rerun-run-off-btn')).toBeVisible();
});

test('a mistyped run-off time is corrected through Re-run, not a delete', async ({ page }) => {
    const { raceId, racers } = await seedRace(page, 'Run Off Correction Seam');
    await createSchedule(page, raceId);
    const heats = await readHeats(page, raceId);

    await recordWithExactTie(page, heats, racers, 'Cy', 'Dee');

    await page.goto(`/race/${raceId}/standings`);
    await page.getByTestId('start-run-off-btn').click();
    await page.getByLabel('Cy Cat').fill('3.050');
    await page.getByLabel('Dee Deer').fill('3.200');
    await page.getByRole('button', { name: 'Record result' }).click();

    await expect(page.getByTestId('run-off-recorded-times')).toContainText('3.050s');

    // Re-run reopens the same entry boxes, prefilled with what is already
    // recorded — the operator is correcting one mistyped number, not
    // starting over.
    await page.getByTestId('rerun-run-off-btn').click();
    await expect(page.getByLabel('Cy Cat')).toHaveValue('3.05');
    await expect(page.getByLabel('Dee Deer')).toHaveValue('3.2');

    await page.getByLabel('Cy Cat').fill('3.010');
    await page.getByRole('button', { name: 'Record result' }).click();

    await expect(page.getByTestId('run-off-recorded-times')).toContainText('3.010s');
    await expect(page.getByTestId('run-off-recorded-times')).not.toContainText('3.050s');
});
