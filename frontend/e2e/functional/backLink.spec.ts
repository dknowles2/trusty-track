/**
 * Leaving a race for an install page and coming back (#959).
 *
 * The unit tests cover `lastRace.ts`'s storage rules and `BackLink`'s three
 * states in isolation; what only a real backend and a real browser show is
 * that `Navigation.tsx` actually writes the race an operator visits, that the
 * value survives a full page navigation (this is `localStorage`, not React
 * state), and that the pill and the back link agree with each other on a
 * fresh page load.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

test('Race -> Settings -> back link -> the same race', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Back Link Round Trip Race');

    const { race } = await gql<{ race: { name: string } }>(
        page,
        `query BackLinkRaceName($id: Int!) { race(raceId: $id) { name } }`,
        { id: raceId },
    );

    // Visiting the race's own roster is what remembers it — any race-scoped
    // page would do this, the roster is simply the one every race has.
    await page.goto(`/race/${raceId}`);
    await expect(page.getByTestId('race-selector-pill')).toContainText(race.name);

    // Leaving for Settings used to drop the race entirely: the pill fell back
    // to "Select a Race" and Settings offered no way back at all.
    await page.goto('/system-settings');
    await expect(page.getByTestId('race-selector-pill')).toContainText(race.name);
    await expect(page.getByTestId('race-selector-pill')).not.toHaveText(/Select a Race/);

    const backLink = page.getByTestId('back-link');
    await expect(backLink).toContainText(`Back to ${race.name}`);
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}$`));
});

test('Timer check and Activity fall back to "Back to settings" with no race remembered', async ({ page }) => {
    // A fresh browser context (Playwright's default per test) holds no
    // `localStorage`, so this is the "never been in a race this device
    // remembers" state — the ordinary one for a brand-new device, or for
    // Home's own link into either page.
    await ensureConfigured(page);

    await page.goto('/timer-check');
    await expect(page.getByTestId('back-link')).toHaveText('Back to settings');
    await expect(page.getByTestId('race-selector-pill')).toContainText('Select a Race');

    await page.goto('/activity');
    await expect(page.getByTestId('back-link')).toHaveText('Back to settings');
});
