/**
 * The results on paper, once the racing is over (#206).
 *
 * The rules are unit-tested in `resultsSheet.test.ts`. What only a real
 * backend shows is that the standings and the award recipients arrive on one
 * page: both are computed on demand rather than stored, and the awards resolve
 * against the same standings the tables print, so the two must agree about who
 * won.
 */

import { test, expect } from '@playwright/test';
import {
    createSchedule,
    ensureConfigured,
    gql,
    readHeats,
    recordRound,
    seedRace,
} from './support';

test('the results sheet prints the standings and the trophies together', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Results Sheet Race');
    await createSchedule(page, raceId);
    await recordRound(page, await readHeats(page, raceId), racers);

    // A speed award resolves against the same standings the tables print, so
    // the sheet cannot disagree with itself about who was fastest.
    await gql(
        page,
        `mutation ResultsAward($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        {
            raceId,
            award: { name: 'Fastest Car', kind: 'SPEED', source: 'ALL', place: 1 },
        },
    );

    await page.goto(`/race/${raceId}/print/results`);

    const sheet = page.getByTestId('results-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Awards' })).toBeVisible();
    const overallHeading = sheet.getByRole('heading', { name: 'Overall standings' });
    await expect(overallHeading).toBeVisible();

    // Car 1 has the lowest time under `recordRound`'s scheme, so it is both
    // *first in the table* — not merely present somewhere on the sheet — and
    // the winner of the speed award.
    const fastest = racers[0];
    // The inner locator for `has` must be built from `page`, not from `sheet`:
    // `has` is evaluated relative to each candidate outer element, and an
    // inner locator that already carries the `results-sheet` testid prefix
    // then asks each <section> to contain *another* `results-sheet` element
    // nested inside it, which never exists.
    const overallSection = sheet
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Overall standings' }) });
    const firstRow = overallSection.locator('tbody tr').first();
    await expect(firstRow).toContainText(String(fastest.carNumber));
    await expect(firstRow).toContainText(`${fastest.firstName} ${fastest.lastName}`);
    await expect(sheet.getByText(/Fastest Car/)).toBeVisible();
});

test('an award nobody has decided prints as not awarded', async ({ page }) => {
    // A missing line reads as an award that does not exist; "Not awarded"
    // reads as one somebody still has to fill in.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Results Sheet Undecided Race');

    await gql(
        page,
        `mutation UndecidedAward($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    await page.goto(`/race/${raceId}/print/results`);

    await expect(page.getByTestId('results-sheet')).toContainText('Not awarded');
});

test('a race that has not started says there is nothing to print', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Results Sheet Empty Race');

    await page.goto(`/race/${raceId}/print/results`);

    await expect(page.getByText(/Nothing to print yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Print/ })).toBeDisabled();
});

test('the standings page links to it', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Results Sheet Link Race');
    await createSchedule(page, raceId);
    await recordRound(page, await readHeats(page, raceId), racers);

    await page.goto(`/race/${raceId}/standings`);
    await page.getByTestId('print-results').click();

    await expect(page.getByTestId('results-sheet')).toBeVisible();
});
