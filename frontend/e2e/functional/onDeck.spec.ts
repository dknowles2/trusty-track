/**
 * What the audience display says is coming (#209).
 *
 * The rule is unit-tested on both sides. What only a real backend can show is
 * that the *payload shape changed correctly*: `onDeck` used to hand back one
 * heat and now hands back a list, which travels over a subscription into a
 * normalized cache. A client reading it as a single object gets `undefined`
 * rather than an error, so both sides can be individually correct and the wall
 * still show nothing — which is how #174's fallback shipped broken.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, seedRace } from './support';

test('the wall names the next two heats, not just the next one', async ({ page }) => {
    // The child named on screen is in the bleachers rather than watching it,
    // so one heat of notice arrives at the moment they are already wanted.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Staging Depth Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/observation`);

    // Scoped to the cards: the race-name button in the header matches plenty
    // of prose, and a spec that reads the whole page is asserting about the
    // navigation as much as about the wall.
    const cards = page.locator('.heat-cards-layout');
    await expect(cards.getByText('Now Racing')).toBeVisible({ timeout: 15000 });
    await expect(cards).toHaveAttribute('data-on-deck-count', '2');
    await expect(cards.getByText('On Deck')).toBeVisible();
    await expect(cards.getByText('After That')).toBeVisible();
});

test('the two cards name different heats', async ({ page }) => {
    // A list read as a single object, or both cards fed from index 0, would
    // show the same heat twice and still look like it was working.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Staging Distinct Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/observation`);
    const cards = page.locator('.heat-cards-layout');
    await expect(cards.getByText('After That')).toBeVisible({ timeout: 15000 });

    const labels = await cards.getByText(/^\(Round \d+, Heat \d+\)$/).allTextContents();

    expect(new Set(labels).size).toBe(labels.length);
});

test('a race with no schedule shows neither card', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Staging Empty Race');

    await page.goto(`/race/${raceId}/observation`);

    const cards = page.locator('.heat-cards-layout');
    await expect(cards.getByText('Now Racing')).toBeVisible({ timeout: 15000 });
    await expect(cards).toHaveAttribute('data-on-deck-count', '0');
    await expect(cards.getByText('After That')).toHaveCount(0);
});
