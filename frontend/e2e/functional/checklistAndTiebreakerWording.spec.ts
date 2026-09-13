/**
 * Two small wording fixes, each verified end to end because a unit test
 * cannot see the real DOM the operator reads (#1089, #1091).
 *
 * `tiebreakText.test.ts` and `RaceFormTiebreaker.test.tsx` already cover the
 * won't-fire table in isolation; this confirms the note actually renders in
 * the real race form, wired to a real race's real scoring strategy.
 * `setupChecklist.test.ts` and `SetupChecklist.test.tsx` cover the `optional`
 * flag and the collapsed line's wording in isolation; this confirms the
 * printables row on a real Roster page carries both the renamed label and
 * the tag.
 */

import { test, expect } from '@playwright/test';
import { seedRace } from './support';

test('Ties: the Lowest-total-time note fires under Cumulative time scoring, and Countback never does (#1089)', async ({
    page,
}) => {
    // `seedRace` creates a TIMED race, which is deliberately *not* the case
    // this asserts: a review of the first version of this rule found that
    // Timed (average) does not make Lowest total time a no-op — a
    // disrupted round (a lane outage, a latecomer) is kept under Timed, so
    // two tied racers can average the same on a different number of heats
    // while their raw totals differ. Cumulative time is the genuine
    // tautology instead (with drop_worst_runs at its default of 0, where
    // Cumulative time's sum and Lowest total time's sum are the same sum).
    // Countback is never flagged under any combination.
    const { raceId } = await seedRace(page, 'Tiebreaker Wording Race');

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /Edit race/ }).click();

    const form = page.locator('form');
    await form.getByTestId('race-settings-nav-scoring').click();
    await form
        .locator('label')
        .filter({ hasText: 'Cumulative time (total)' })
        .locator('input[type="radio"]')
        .click();

    const ties = form.getByRole('group', { name: 'Ties' });
    const totalTimeRow = ties.locator('label').filter({ hasText: 'Lowest total time' });
    const countbackRow = ties.locator('label').filter({ hasText: 'Countback' });

    await expect(totalTimeRow).toContainText(/won.t fire for this race/i);
    await expect(countbackRow).not.toContainText(/won.t fire/i);
});

test('Setup checklist: the printables row reads "Print anything you need" and is tagged optional (#1091)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Checklist Wording Race');

    await page.goto(`/race/${raceId}`);

    // `seedRace` checks the roster in already, so the panel defaults to its
    // collapsed one-line form (#949) — open it to reach the row.
    await page.getByTestId('setup-checklist-summary').click();

    const printablesRow = page.getByTestId('setup-step-printables');
    await expect(printablesRow).toContainText('Print anything you need');
    await expect(printablesRow).toContainText('optional');

    // The four required steps carry no such tag.
    const racersRow = page.getByTestId('setup-step-racers');
    await expect(racersRow).not.toContainText('optional');
});
