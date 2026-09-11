/**
 * The print hub (#957) — before this, printing had four front doors on four
 * different pages and nothing that listed everything a race can print.
 * `/race/:raceId/print` becomes the hub: the four sheet-and-print documents
 * stay exactly where they are, and a second row of cards links out to the
 * three documents that already have their own page for their own reason
 * (the heat sheet prints the schedule, the results sheet lives on Standings,
 * certificates live on Awards).
 *
 * The rules for what is on the hub are unit-tested in `Printables.test.tsx`.
 * What only a real backend and a real browser show is the doors that were
 * supposed to reach it actually do: Home's overflow menu and the roster's
 * own overflow.
 *
 * The setup checklist's printables step is deliberately not covered here.
 * `checklistFor` (`setupChecklist.ts`) marks that step done at the exact
 * moment the checkin step is — both read `checkedInCount > 0` — so it can
 * never actually be the checklist's "next" step in a real progression: by
 * the time checkin clears, printables already has too. `RaceDetails.test.tsx`
 * exercises the `onAction.printables` wiring directly, against a stubbed
 * `SetupChecklist`, for exactly that reason.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, seedRace } from './support';

test("Home's overflow menu has a Print entry that opens the hub (#957)", async ({ page }) => {
    const { raceId } = await seedRace(page, 'Home Print Route');

    await ensureConfigured(page);
    await page.goto('/');

    await page.getByTestId(`race-more-menu-${raceId}`).click();
    await page.getByTestId(`race-menu-print-${raceId}`).click();

    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/print$`));
    await expect(page.getByRole('heading', { name: 'Print' })).toBeVisible();
});

test('the hub lists every printable document, and the round trip to the heat sheet works (#957)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Print Hub Round Trip');
    await createSchedule(page, raceId);

    await ensureConfigured(page);
    await page.goto('/');

    await page.getByTestId(`race-more-menu-${raceId}`).click();
    await page.getByTestId(`race-menu-print-${raceId}`).click();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/print$`));

    // The four sheet-and-print documents are still picked from right here…
    await expect(page.getByRole('button', { name: /Pit passes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Driver's licences/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Check-in codes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Car labels/ })).toBeVisible();

    // …and the three that live on their own page are reachable from here too.
    await expect(page.getByRole('link', { name: /Results sheet/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Certificates/ })).toBeVisible();

    await page.getByRole('link', { name: /Heat sheet/ }).click();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/print/heat-sheet$`));
    await expect(page.locator('.heat-sheet')).toBeVisible();
});

test('the roster overflow still opens the hub, now labelled as a picker (#957)', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Roster Print Ellipsis');

    await page.goto(`/race/${raceId}`);
    await page.getByTestId('roster-more-menu').click();

    const printEntry = page.getByRole('button', { name: /^Print…/ });
    await expect(printEntry).toBeVisible();
    await printEntry.click();

    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/print$`));
});
