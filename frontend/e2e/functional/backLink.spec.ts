/**
 * Leaving a race for an install page and coming back (#959, #1077).
 *
 * The unit tests cover `lastRace.ts`'s storage rules and `BackLink`'s states
 * in isolation; what only a real backend and a real browser show is that
 * `Navigation.tsx` actually writes the race an operator visits, that the
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

test('once a race is remembered, Timer check and Activity still lead back to Settings (#1077)', async ({ page }) => {
    // The bug: a component test in isolation can pass a `fallback` prop and
    // assert what it renders, but it cannot show that `BackLink` on the real
    // page is reached with a race *already* remembered from having actually
    // been in one this session — which is the ordinary shape of a real visit,
    // and exactly the case #959's own regression test above did not cover.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Back Link Settings Detour Race');

    const { race } = await gql<{ race: { name: string } }>(
        page,
        `query BackLinkDetourRaceName($id: Int!) { race(raceId: $id) { name } }`,
        { id: raceId },
    );

    // Remember a race the ordinary way — visiting it.
    await page.goto(`/race/${raceId}`);
    await expect(page.getByTestId('race-selector-pill')).toContainText(race.name);

    // Settings itself still goes back to the remembered race — nothing about
    // Settings' own case changes here.
    await page.goto('/system-settings');
    await expect(page.getByTestId('back-link')).toContainText(`Back to ${race.name}`);

    // Timer check, reached from Settings: its back link must go back to
    // Settings, not hijack the remembered race.
    await page.getByRole('link', { name: /Timer check/ }).click();
    await expect(page).toHaveURL(/\/timer-check/);
    const timerCheckBackLink = page.getByTestId('back-link');
    await expect(timerCheckBackLink).toHaveText('Back to settings');
    await timerCheckBackLink.click();
    await expect(page).toHaveURL(/\/system-settings/);

    // From Settings, back once more reaches the race — Settings' own back
    // link was never the broken one.
    await page.getByTestId('back-link').click();
    await expect(page).toHaveURL(new RegExp(`/race/${raceId}$`));

    // Same story for Activity.
    await page.goto('/system-settings');
    await page.getByRole('link', { name: /Activity log/ }).click();
    await expect(page).toHaveURL(/\/activity/);
    const activityBackLink = page.getByTestId('back-link');
    await expect(activityBackLink).toHaveText('Back to settings');
    await activityBackLink.click();
    await expect(page).toHaveURL(/\/system-settings/);
});
