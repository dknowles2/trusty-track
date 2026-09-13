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

test('Ties: the Lowest-total-time note fires under Timed scoring, and Countback never does (#1089)', async ({
    page,
}) => {
    // `seedRace` creates a TIMED race on a track with a real (fake) timer —
    // exactly the combination under which Lowest total time can never break
    // a tie (a tie on the average is a tie on the total behind it), and
    // Countback is never flagged under any combination.
    const { raceId } = await seedRace(page, 'Tiebreaker Wording Race');

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /Edit race/ }).click();

    const form = page.locator('form');
    await form.getByTestId('race-settings-nav-scoring').click();

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
