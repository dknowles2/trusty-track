/**
 * The awards ceremony's way out (#955).
 *
 * `/race/:id/awards/present` hides the app chrome (`Navigation.tsx`'s early
 * return), and the reported bug was that it then offered no way back — no
 * close control, no link, and Escape did nothing, leaving only a browser's
 * own Back button, which a kiosk or a full-screen tablet may not have.
 *
 * Two pieces, covered here end to end because both are about a real second
 * browsing context or a real route change, neither of which a unit test can
 * see: **Present** now opens the ceremony in a new tab (`Awards.test.tsx`
 * covers the `window.open` call itself with a spy — this is the one thing
 * worth proving actually opens a page), and the ceremony's own "Back to
 * awards" link and Escape key (`AwardCeremony.test.tsx` covers the fade
 * timing and the modifier guard) actually land back on the Awards page.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

test('Present opens the ceremony in a new tab', async ({ page, context }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony New Tab Race');

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    await page.goto(`/race/${raceId}/awards`);
    await expect(page.getByText('Best Paint')).toBeVisible();

    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('button', { name: 'Present' }).click(),
    ]);
    await popup.waitForLoadState('networkidle');
    expect(popup.url()).toContain(`/race/${raceId}/awards/present`);

    // The operator's own tab is untouched — it is still the Awards page, not
    // the ceremony, which is the whole point of opening a second tab.
    await expect(page.getByText('Best Paint')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Present' })).toBeVisible();

    await popup.close();
});

test('the ceremony has a way back on the same tab it opened in', async ({ page }) => {
    // The primary journey the issue names: an operator on their own laptop,
    // in the same tab, ends up on the ceremony — by a bookmark, a typed URL,
    // or (before this fix) the browser's own Back/Forward history.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Back Link Race');

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    await page.goto(`/race/${raceId}/awards/present`);
    await expect(page.getByText('Best Paint')).toBeVisible();

    const backLink = page.getByTestId('ceremony-back-link');
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/awards$`));
    await expect(page.getByRole('button', { name: 'Present' })).toBeVisible();
});

test('Escape leaves the ceremony', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Escape Race');

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    await page.goto(`/race/${raceId}/awards/present`);
    await expect(page.getByText('Best Paint')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(new RegExp(`/race/${raceId}/awards$`));
    await expect(page.getByRole('button', { name: 'Present' })).toBeVisible();
});
