/**
 * The execution flow follows the master running order (#549).
 *
 * The interleave itself is pinned by `test_domain_running_order.py`, the
 * subscriptions by `test_master_running_order_execution.py`, and the sort rule
 * on this side by `runningOrder.test.ts`. What none of those can see is the
 * whole point of the feature arriving on the operator's screen: two dens'
 * rounds, one interleaved sequence, and the Race tab actually offering the
 * other den's heat next — through the GraphQL round trip, the normalized
 * cache, and `RaceControl`'s heat pinning (#130), any of which could quietly
 * put the race back into one-block-per-round order while every unit test
 * stayed green.
 */

import { test, expect, type Page } from '@playwright/test';
import { gql, readHeats, seedRace, type Heat } from './support';

interface InterleavedRace {
    raceId: number;
    /** Pending heats in master order (ascending `heatNumber` after apply). */
    order: Heat[];
    /** Round id → round name ("Lions" / "Tigers", from the racing groups). */
    roundName: Map<number, string>;
}

/**
 * A race with two racing groups, one wizard round per group, the flag on and
 * the interleave applied — all through the API, per this suite's convention:
 * the one step under test is what the browser drives.
 */
async function seedInterleaved(page: Page, name: string): Promise<InterleavedRace> {
    const { raceId, racers } = await seedRace(page, name);

    const groupIds: number[] = [];
    for (const groupName of ['Lions', 'Tigers']) {
        const created = await gql<{ createRacingGroup: { id: number } }>(
            page,
            `mutation SeedGroup($raceId: Int!, $racingGroup: RacingGroupInput!) {
                createRacingGroup(raceId: $raceId, racingGroup: $racingGroup) { id }
            }`,
            { raceId, racingGroup: { name: groupName, color: '#003F87' } },
        );
        groupIds.push(created.createRacingGroup.id);
    }
    await gql(
        page,
        `mutation SeedMove($racerIds: [Int!]!, $racingGroupId: Int) {
            bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
        }`,
        { racerIds: racers.slice(0, 3).map((r) => r.id), racingGroupId: groupIds[0] },
    );
    await gql(
        page,
        `mutation SeedMove($racerIds: [Int!]!, $racingGroupId: Int) {
            bulkMoveToRacingGroup(racerIds: $racerIds, racingGroupId: $racingGroupId)
        }`,
        { racerIds: racers.slice(3).map((r) => r.id), racingGroupId: groupIds[1] },
    );

    // One general round per racing group — the schedule shape the master
    // running order exists for.
    await gql(
        page,
        `mutation SeedDenRounds($raceId: Int!, $config: WizardConfigurationInput!) {
            createRoundWizard(raceId: $raceId, config: $config) { id }
        }`,
        {
            raceId,
            config: {
                generalRound: { type: 'EACH_GROUP', runsPerLane: 1 },
                championshipRounds: [],
            },
        },
    );

    await gql(
        page,
        `mutation SeedFlag($id: Int!) {
            updateRace(id: $id, race: { masterRunningOrder: true }) { id masterRunningOrder }
        }`,
        { id: raceId },
    );
    await gql(
        page,
        `mutation SeedApply($raceId: Int!) {
            applyMasterRunningOrder(raceId: $raceId) { updatedCount }
        }`,
        { raceId },
    );

    const named = await gql<{ rounds: { id: number; name: string | null }[] }>(
        page,
        `query SeedRoundNames($raceId: Int!) { rounds(raceId: $raceId) { id name } }`,
        { raceId },
    );
    const roundName = new Map(named.rounds.map((r) => [r.id, r.name ?? '']));

    const order = (await readHeats(page, raceId)).sort((a, b) => a.heatNumber - b.heatNumber);
    // The fixture holds what the feature promises: with two equal dens the
    // interleave alternates, so the very first two heats come from different
    // rounds. A spec that raced two same-round heats would prove nothing.
    expect(order[0].roundId).not.toBe(order[1].roundId);

    return { raceId, order, roundName };
}

/** The active-heat card: the `Heat N` heading with its round label beside it. */
function activeHeatCard(page: Page) {
    return page.getByRole('heading', { name: /^Heat \d+$/ }).locator('../..');
}

test('the race tab offers the other den\'s heat next, not the same round\'s', async ({
    page,
}) => {
    const { raceId, order, roundName } = await seedInterleaved(page, 'Master Order Race Tab');
    const firstRound = roundName.get(order[0].roundId!)!;
    const secondRound = roundName.get(order[1].roundId!)!;

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });

    // The heat on offer is the master order's first — labelled with its den.
    await expect(page.getByRole('heading', { name: 'Heat 1' })).toBeVisible();
    await expect(activeHeatCard(page)).toContainText(firstRound);

    // And On Deck stages the *other* den's line-up rather than announcing
    // "End of Round" — which is exactly the staging information the
    // interleave exists to put in front of the room.
    await expect(page.getByText('End of Round')).toHaveCount(0);
    await expect(page.getByText(secondRound).first()).toBeVisible();

    // Run the heat on the fake timer and advance: the next heat is the other
    // den's, mid-round — under the old (roundNumber, heatNumber) sort this
    // heading would still say the first den's name.
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    await expect(page.getByRole('button', { name: /^Next Heat/ })).toBeVisible({
        timeout: 30000,
    });
    await page.getByRole('button', { name: /^Next Heat/ }).click();

    await expect(page.getByRole('heading', { name: 'Heat 2' })).toBeVisible({ timeout: 30000 });
    await expect(activeHeatCard(page)).toContainText(secondRound);
});

test('the schedule lets a later round\'s heat run while an earlier round is open', async ({
    page,
}) => {
    // The other half of the gap: `ScheduleManagement` disabled every heat of
    // round N+1 until round N was fully finished ("Complete previous rounds
    // first"), which under a master order would mean the interleave's second
    // pick could never be run at all.
    const { raceId, order, roundName } = await seedInterleaved(page, 'Master Order Schedule');
    const secondPick = order[1];

    // Record the master order's first heat through the API, so the first
    // round is demonstrably still open when the second round's heat runs.
    await gql(
        page,
        `mutation SeedFirstResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
            updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
        }`,
        {
            heatId: order[0].id,
            // Every lane row, occupied or not — a den of three on a four-lane
            // track leaves a lane empty, and the mutation checks the schedule.
            lanes: order[0].lanes.map((l, idx) => ({
                lane: l.lane,
                racerId: l.racerId,
                placeholderSlot: l.placeholderSlot,
                time: l.racerId !== null ? 3.1 + idx / 100 : null,
                place: l.racerId !== null ? idx + 1 : null,
            })),
        },
    );

    await page.goto(`/race/${raceId}/control`);
    // The stage-4 master-order panel lists every heat too, so scope to the
    // per-round tables' rows — the ones carrying a Run button.
    const row = page
        .getByRole('row')
        .filter({ hasText: `Heat ${secondPick.heatNumber}` })
        .filter({ has: page.getByRole('button', { name: 'Run', exact: true }) });
    await expect(row).toBeVisible({ timeout: 30000 });

    // No round is gated behind another any more.
    await expect(page.getByTitle('Complete previous rounds first')).toHaveCount(0);

    // Run the other den's heat straight from its row.
    const runButton = row.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    // Landed on the Race tab with that den's heat armed-able and labelled.
    await expect(page.getByRole('heading', { name: /^Heat \d+$/ })).toBeVisible({
        timeout: 30000,
    });
    await expect(activeHeatCard(page)).toContainText(roundName.get(secondPick.roundId!)!);
});
