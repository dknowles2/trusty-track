/**
 * Championship trophies auto-populate on the Awards page (#1082).
 *
 * The backend wiring (wizard/createRound seeding, the guard against seeding
 * twice, the query-count and role/lock/audit behaviour) is covered end to
 * end already in `backend/tests/test_championship_award_seed.py` and
 * `test_format_crossings.py`. What only a real browser proves is that the
 * Awards page itself renders the seeded set with no recipient until the
 * final is actually raced, and that the empty-state button — reached after
 * an operator deletes a seeded set — brings it back through the real
 * mutation and a real refetch.
 */

import { test, expect } from '@playwright/test';
import {
    ensureConfigured,
    gql,
    createSchedule,
    readHeats,
    readRounds,
    recordRound,
    seedRace,
} from './support';

test('the Round Wizard seeds the championship trophies, and racing the final resolves them', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Championship Award Seed Race');

    // The wizard's own championship round — three racers advance, matching
    // this race's default `championshipTrophies` of 3, so nothing is
    // capped.
    await createSchedule(page, raceId, { name: 'Grand Finals', numTopRacers: 3 });

    await page.goto(`/race/${raceId}/awards`);

    // Seeded, and undecided: nobody has raced yet.
    for (const name of ['1st Place', '2nd Place', '3rd Place']) {
        const row = page.locator('li').filter({ hasText: name });
        await expect(row.getByText('Not decided by the racing yet')).toBeVisible();
    }

    // Race the general round. Car *n* runs `3.0 + n/100`, so ascending car
    // number is ascending time — the three lowest car numbers (1, 2, 3)
    // advance to the final.
    const rounds = await readRounds(page, raceId);
    const generalRound = rounds.find((r) => r.advancementSource === null)!;
    const finalRound = rounds.find((r) => r.advancementSource !== null)!;

    const generalHeats = (await readHeats(page, raceId)).filter(
        (h) => h.roundId === generalRound.id,
    );
    await recordRound(page, generalHeats, racers);

    // Race the final. Same car-number-orders-time rule, so car 1 (Ada Ant)
    // wins it, car 2 (Ben Bear) is 2nd, car 3 (Cy Cat) is 3rd.
    const finalHeats = (await readHeats(page, raceId)).filter(
        (h) => h.roundId === finalRound.id,
    );
    await recordRound(page, finalHeats, racers);

    await page.goto(`/race/${raceId}/awards`);
    const firstRow = page.locator('li').filter({ hasText: '1st Place' });
    await expect(firstRow.getByText('Ada Ant (#1)')).toBeVisible();
    const secondRow = page.locator('li').filter({ hasText: '2nd Place' });
    await expect(secondRow.getByText('Ben Bear (#2)')).toBeVisible();
    const thirdRow = page.locator('li').filter({ hasText: '3rd Place' });
    await expect(thirdRow.getByText('Cy Cat (#3)')).toBeVisible();
});

test('the empty-state button brings a deleted championship trophy set back', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Championship Award Restore Race');
    await createSchedule(page, raceId, { name: 'Grand Finals', numTopRacers: 3 });

    // Confirm the wizard actually seeded before deleting, so a failed
    // deletion below could not be mistaken for the button doing nothing.
    const before = await gql<{ race: { awards: { id: number; kind: string }[] } }>(
        page,
        `query Awards($raceId: Int!) { race(raceId: $raceId) { awards { id kind } } }`,
        { raceId },
    );
    const speedAwardIds = before.race.awards
        .filter((award) => award.kind === 'SPEED')
        .map((award) => award.id);
    expect(speedAwardIds).toHaveLength(3);

    for (const id of speedAwardIds) {
        await gql(page, `mutation Delete($id: Int!) { deleteAward(id: $id) }`, { id });
    }

    await page.goto(`/race/${raceId}/awards`);
    const seedButton = page.getByRole('button', { name: 'Add the 3 championship trophies' });
    await expect(seedButton).toBeVisible();
    await expect(page.getByText('1st Place', { exact: true })).not.toBeVisible();

    await seedButton.click();

    await expect(page.getByText('1st Place', { exact: true })).toBeVisible();
    await expect(page.getByText('2nd Place', { exact: true })).toBeVisible();
    await expect(page.getByText('3rd Place', { exact: true })).toBeVisible();
    await expect(seedButton).not.toBeVisible();
});
