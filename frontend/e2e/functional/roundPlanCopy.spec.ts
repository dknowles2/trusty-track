/**
 * Copying a previous race carries its round plan and re-points a speed
 * award that names one of its rounds at the new race's own round (#1088).
 *
 * `RaceSetupWizard.test.tsx` and `raceSetup.test.ts` cover the derivation,
 * the remap and the exclusion reasons in isolation; this is the one thing
 * those cannot see — that the served page, the real `createRace` round
 * trip and the normalized cache agree that the new race's Schedule tab
 * shows the same rounds and its Awards tab shows the copied award pointed
 * at its own final, not the source race's.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- roundPlanCopy.spec.ts
 */

import { test, expect } from '@playwright/test';
import { gql, seedRace, createSchedule, readRounds } from './support';

test('copying a race carries its round plan and re-points a round-scoped award', async ({
    page,
}) => {
    const stamp = `${test.info().parallelIndex}-${test.info().retry}-${Date.now()}`;
    const sourceName = `Round Plan Source ${stamp}`;
    const copyName = `Round Plan Copy ${stamp}`;

    // Seed the source race through GraphQL — a PPC qualifying round and a
    // top-3 "Finals" championship round, the same door `test_wizard_
    // round_styles.py`'s backend counterpart drives.
    const { raceId: sourceId } = await seedRace(page, sourceName);
    await createSchedule(page, sourceId, { name: 'Finals', numTopRacers: 3 });
    const sourceRounds = await readRounds(page, sourceId);
    const finals = sourceRounds.find((r) => r.advancementSource !== null);
    if (!finals) throw new Error('createSchedule did not build a championship round');

    // A speed award naming that final by id — the shape `championship_
    // award_seed` itself would have produced, given a name an operator
    // actually picks.
    await gql(
        page,
        `mutation SeedRoundAward($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        {
            raceId: sourceId,
            award: { name: 'Pack Champion', kind: 'SPEED', source: `ROUND:${finals.id}`, place: 1 },
        },
    );

    // Drive the one step under test with the browser: the copy step, the
    // round-plan summary and checkbox, and the awards preview.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Create New Race/i }).click();
    await expect(page.getByRole('heading', { name: 'Create New Race Event' })).toBeVisible();

    await expect(page.getByTestId('setup-step-start')).toBeVisible();
    await page.getByRole('radio', { name: /^Copy settings from a previous race/ }).click();
    await page.getByLabel('Previous race', { exact: true }).selectOption({ label: sourceName });
    await expect(page.getByTestId('setup-source-awards-summary')).toBeVisible();

    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    // The award preview shows the round-scoped award as copyable, since the
    // round plan reproduces the round it names — the same preview that used
    // to exclude every `ROUND:` award outright.
    await expect(page.getByTestId('setup-awards-copy-summary')).toContainText('Pack Champion');
    await expect(page.getByTestId('setup-awards-excluded')).toHaveCount(0);

    await page.getByTestId('setup-next').click();
    await expect(page.getByLabel('Event Name')).toBeVisible();
    // The round summary and its checkbox, on by default (#1088).
    await expect(page.getByTestId('setup-round-plan-summary')).toContainText('1 qualifying (PPC');
    await expect(page.getByTestId('setup-round-plan-summary')).toContainText('Finals (top 3)');
    await expect(page.getByRole('checkbox', { name: 'Copy the rounds too' })).toBeChecked();

    await page.getByLabel('Event Name').fill(copyName);
    await page.getByRole('button', { name: 'Create Race' }).click();

    await page.waitForURL(/\/race\/\d+$/);
    const newRaceId = Number(page.url().match(/\/race\/(\d+)$/)?.[1]);
    expect(Number.isFinite(newRaceId)).toBe(true);

    // The copy happens at race-creation time, before any roster exists —
    // the general round is created with no heats yet rather than refusing
    // the whole race (`tolerate_empty_roster`), and the championship
    // round's placeholder heats need no roster at all. Add a roster, the
    // same order an operator actually follows, and regenerate the general
    // round the same way they would recover one from a lane outage.
    for (const racer of [
        { firstName: 'Gia', lastName: 'Goat' },
        { firstName: 'Hal', lastName: 'Hare' },
    ]) {
        const created = await gql<{ createRacer: { id: number } }>(
            page,
            `mutation NewRaceRacer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
            { racer: { raceId: newRaceId, ...racer } },
        );
        await gql(
            page,
            `mutation NewRaceCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: created.createRacer.id },
        );
    }
    const newRoundsBeforeRegen = await readRounds(page, newRaceId);
    const newGeneral = newRoundsBeforeRegen.find((r) => r.advancementSource === null);
    if (!newGeneral) throw new Error('the copy did not build a general round');
    await gql(
        page,
        `mutation RegenerateGeneral($roundId: Int!) { regenerateRound(roundId: $roundId) { id } }`,
        { roundId: newGeneral.id },
    );

    // The Schedule tab shows the same rounds the source race had.
    await page.goto(`/race/${newRaceId}/control/schedule`);
    await expect(page.getByText('All Pack')).toBeVisible();
    await expect(page.getByText('Finals')).toBeVisible();

    // The Awards tab shows Pack Champion, pointed at its own final —
    // resolving to nobody until that final is raced.
    await page.goto(`/race/${newRaceId}/awards`);
    const packChampionRow = page.locator('li').filter({ hasText: 'Pack Champion' });
    await expect(packChampionRow).toBeVisible();
    await expect(packChampionRow.getByText('Not decided by the racing yet')).toBeVisible();

    // And it is a genuinely different round from the source's — the whole
    // point of the remap, not merely the same source string surviving by
    // coincidence.
    const newRounds = await readRounds(page, newRaceId);
    const newFinals = newRounds.find((r) => r.advancementSource !== null);
    expect(newFinals?.id).not.toBe(finals.id);
});
