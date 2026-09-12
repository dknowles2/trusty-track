/**
 * A race whose only round is elimination: the Standings page and the Live
 * display both have to find that round's own result, rather than the
 * ordinary "Overall (qualifying rounds)" aggregate — which
 * `services.scoring._scoring_heats` excludes elimination heats from by
 * design, so it stays empty however completely the race is raced (#1020).
 *
 * The bug sat at the seam between two individually-tested features: the
 * elimination scheduler (unit-tested for its own wave-by-wave mechanics)
 * and the Standings/Observation screens (unit-tested against races that
 * always had a PPC/BALANCED round to fall back to). Nothing exercised the
 * combination — an elimination round with nothing else — end to end.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- eliminationOnlyStandings.spec.ts
 */

import { test, expect } from '@playwright/test';
import { gql, readHeats, seedRace, type Heat } from './support';

/** Play an elimination round to a decided winner, strongest racer first. */
async function playEliminationToWinner(
    page: import('@playwright/test').Page,
    raceId: number,
    strengthOrder: number[],
): Promise<void> {
    for (let safety = 0; safety < 20; safety++) {
        const heats: Heat[] = await readHeats(page, raceId);
        const pending = heats.filter(
            (heat) =>
                heat.lanes.some((lane) => lane.racerId !== null) &&
                !heat.lanes.some((lane) => lane.time !== null || lane.place !== null),
        );
        if (pending.length === 0) break;

        for (const heat of pending) {
            const running = heat.lanes.filter((lane) => lane.racerId !== null);
            const order = [...running].sort(
                (a, b) => strengthOrder.indexOf(a.racerId!) - strengthOrder.indexOf(b.racerId!),
            );
            const lanes = running.map((lane) => ({
                lane: lane.lane,
                racerId: lane.racerId,
                time: 3.05 + order.findIndex((o) => o.racerId === lane.racerId) * 0.14,
                place: order.findIndex((o) => o.racerId === lane.racerId) + 1,
            }));
            await gql(
                page,
                `mutation Result($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                    updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
                }`,
                { heatId: heat.id, lanes },
            );
        }
    }
}

test('an elimination-only race: Standings defaults to the elimination round, and the Live display shows its winner', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Elimination Only Standings Seam');

    // The race's *only* round — no wizard, no preliminary round to fall
    // back to, which is exactly the shape #1020 is about.
    await gql(
        page,
        `mutation CreateElim($raceId: Int!, $roundData: RoundCreateInput!) {
            createRound(raceId: $raceId, roundData: $roundData) { id }
        }`,
        {
            raceId,
            roundData: {
                schedulingStrategy: 'ELIMINATION',
                name: 'Elimination Round',
                eliminationLosses: 1,
            },
        },
    );

    // Racers are seeded strongest-first (Ada never loses); racing the whole
    // bracket out through the API is not the step under test.
    const strengthOrder = racers.map((r) => r.id);
    await playEliminationToWinner(page, raceId, strengthOrder);

    // Standings: nothing to pick — the selector already landed on the
    // elimination round, and its winner is on top, scored in losses.
    await page.goto(`/race/${raceId}/standings`);
    const scopeSelect = page.getByLabel('Standings scope');
    await expect(scopeSelect).toBeVisible();
    await expect(scopeSelect).not.toHaveValue('');
    await expect(page.getByRole('columnheader', { name: 'Losses' })).toBeVisible();
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toContainText('Ada Ant');
    await expect(firstRow).toContainText('0');
    // The "Overall standings cover the qualifying rounds" banner never
    // applies to a race with no qualifying round at all.
    await expect(page.getByText(/cover the qualifying rounds/i)).toHaveCount(0);

    // Live display: the "Race complete!" screen names the elimination
    // round and its winner, rather than falling back to an aggregate that
    // was always going to be empty.
    await page.goto(`/race/${raceId}/observation`);
    await expect(page.getByText('Race complete!')).toBeVisible();
    await expect(page.getByText('Elimination Round results')).toBeVisible();
    await expect(page.getByText('Ada Ant')).toBeVisible();
});
