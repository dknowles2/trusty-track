/**
 * Re-Run, end to end (#1083, #1084).
 *
 * Both bugs live in the same click — `RaceControl.tsx`'s `handleRunHeat` —
 * and both are unit-tested on their own (`RaceControlReRunConfirm.test.tsx`,
 * `RaceControlOnDeck.test.tsx`, `runningOrder.test.ts`). What only a real
 * backend and a second real page can show is that the two sides of #1084
 * agree with each other, and that #1083's confirmation genuinely leaves the
 * server untouched on Cancel rather than merely not calling a mock.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, readHeats, recordRound, seedRace } from './support';

test('re-running an earlier heat sends On Deck to the next unfinished one, on both screens (#1084)', async ({
    page,
    context,
}) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Re-Run On Deck Race');
    await createSchedule(page, raceId);

    // One racer per heat (#26's "lane 1 seeded with every racer"), so six
    // racers means six heats — enough to have something genuinely unfinished
    // both before and after the two already-recorded heats this leaves in
    // the way.
    const heats = (await readHeats(page, raceId)).sort((a, b) => a.heatNumber - b.heatNumber);
    expect(heats.length).toBeGreaterThanOrEqual(6);
    await recordRound(page, heats.slice(0, 4), racers); // heats 1–4 recorded; 5, 6 are not.

    // Re-run heat 2 from the Schedule tab's own row button — the other
    // caller `handleRunHeat` has to reach besides the Race tab's Re-Run.
    await page.goto(`/race/${raceId}/control/schedule`);
    const heat2Row = page.getByRole('row').filter({ hasText: 'Heat 2' });
    await heat2Row.getByRole('button', { name: 'Re-Run' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Re-run Heat' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Re-run' }).click();
    await expect(confirmDialog).toBeHidden();
    // Cleared, and confirming does what Run does (#1295): the operator lands
    // on the Race tab with heat 2 — the heat just cleared — up and ready to
    // arm, rather than staying on this row to notice for themselves that it
    // now reads "Run". No `page.goto` needed to get there; asserting on the
    // Schedule row's own button after this click would be racing the
    // navigation that already carried the page away from it.
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/control/race$`));
    await expect(page.getByRole('heading', { name: 'Heat 2' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Start Timer' })).toBeVisible();

    // On Deck must skip the already-recorded heats 3 and 4 and land on
    // heat 5 — not heat 3, the positional successor.
    const onDeckPanel = page.getByTestId('race-execution-right-column');
    await expect(onDeckPanel).toContainText('Heat 5');
    await expect(onDeckPanel).not.toContainText('Heat 3');
    await expect(onDeckPanel).not.toContainText('Heat 4');

    // A wall display watching the same race must name the same heat — the
    // whole point of the client and the backend sharing one running-order
    // rule (`runningOrder.ts` mirroring `_unfinished`) rather than each
    // inventing its own notion of "next". This is the one check a unit test
    // on either side alone cannot make: it is only a bug when the two answers
    // differ.
    const observationPage = await context.newPage();
    await observationPage.goto(`/race/${raceId}/observation`);
    const onDeckCard = observationPage
        .locator('.heat-card')
        .filter({ has: observationPage.getByText('On Deck', { exact: true }) });
    await expect(onDeckCard).toContainText('Heat 5', { timeout: 15000 });
    await observationPage.close();
});

test('Re-Run asks first: Cancel leaves the result on the server, confirming clears it (#1083)', async ({
    page,
}) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Re-Run Confirm Round Trip');
    await createSchedule(page, raceId);

    const heats = (await readHeats(page, raceId)).sort((a, b) => a.heatNumber - b.heatNumber);
    await recordRound(page, heats.slice(0, 1), racers); // heat 1 only.

    await page.goto(`/race/${raceId}/control/schedule`);
    const heat1Row = page.getByRole('row').filter({ hasText: 'Heat 1' });
    await expect(heat1Row.getByRole('button', { name: 'Re-Run' })).toBeVisible();

    // Cancel: the dialog closes, and nothing was sent to the server.
    await heat1Row.getByRole('button', { name: 'Re-Run' }).click();
    const dialog = page.getByRole('dialog', { name: 'Re-run Heat' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // A reload proves it: this reads from the server, not the page's own
    // still-warm state, so the times shown are only there if the mutation
    // never ran.
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: 'Heat 1' }).getByRole('button', { name: 'Re-Run' })).toBeVisible();
    const stillRecorded = (await readHeats(page, raceId)).find((h) => h.heatNumber === 1)!;
    expect(stillRecorded.lanes.some((l) => l.time !== null)).toBe(true);

    // Confirm this time: the heat goes back to pending on the server too.
    // Confirming also does what Run does (#1295) — it takes the operator
    // straight to the Race tab with heat 1 up, rather than leaving them on
    // this row to notice for themselves that it now reads "Run".
    await page.getByRole('row').filter({ hasText: 'Heat 1' }).getByRole('button', { name: 'Re-Run' }).click();
    await page.getByRole('dialog', { name: 'Re-run Heat' }).getByRole('button', { name: 'Re-run' }).click();
    await expect(page.getByRole('dialog', { name: 'Re-run Heat' })).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/control/race$`));
    await expect(page.getByRole('heading', { name: 'Heat 1' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Start Timer' })).toBeVisible();

    const cleared = (await readHeats(page, raceId)).find((h) => h.heatNumber === 1)!;
    expect(cleared.lanes.every((l) => l.time === null)).toBe(true);
});
