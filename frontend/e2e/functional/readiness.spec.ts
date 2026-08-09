/**
 * The pre-flight strip on Race Control (#200).
 *
 * The rules are unit-tested in `readiness.test.ts`. What only a real backend
 * can show is that the four answers actually *arrive* on one screen: the
 * timer's state over a subscription, the roster's counts and the heats out of
 * the race query, and the audience displays out of theirs. Each side was
 * individually correct in #174 too, and the whole was still broken.
 */

import { test, expect } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, seedRace } from './support';

test('a race with no schedule says so before the operator arms anything', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Readiness No Schedule Race');

    await page.goto(`/race/${raceId}/control`);

    const strip = page.getByTestId('readiness-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-level', 'BLOCKED');
    await expect(page.getByTestId('readiness-schedule')).toHaveAttribute('data-level', 'BLOCKED');
    await expect(page.getByTestId('readiness-checkin')).toHaveAttribute('data-level', 'OK');
});

test('an uninspected roster blocks, and says how many are through', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Readiness Part Checked In Race');

    // Put one car back to uninspected: some-but-not-all is the ordinary state
    // of a race morning, and it should read as amber rather than as a fault.
    await gql(
        page,
        `mutation UndoCheckIn($id: Int!) {
            checkInRacer(id: $id, passedInspection: false, weight: null) { id }
        }`,
        { id: racers[0].id },
    );
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control`);

    await expect(page.getByTestId('readiness-checkin')).toHaveAttribute('data-level', 'ATTENTION');
    await expect(page.getByText(/5 of 6 checked in/)).toBeVisible();
});

test('a fully prepared race collapses to one line', async ({ page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Readiness Ready Race');
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control`);

    const strip = page.getByTestId('readiness-strip');
    await expect(strip).toHaveAttribute('data-level', 'OK');
    await expect(strip.getByText('Ready to race')).toBeVisible();
    // Collapsed: the per-item rows are gone, and the counts moved into the
    // one-liner rather than being dropped.
    await expect(page.getByTestId('readiness-checkin')).toHaveCount(0);
    await expect(strip.getByText(/All 6 checked in/)).toBeVisible();
});

test('an audience display shows up in the count', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId, racers } = await seedRace(page, 'Readiness Displays Race');
    await createSchedule(page, raceId);

    // The display count lives in the expanded list, and the list only appears
    // while something wants attention — so put one car back to uninspected.
    await gql(
        page,
        `mutation UndoCheckIn($id: Int!) {
            checkInRacer(id: $id, passedInspection: false, weight: null) { id }
        }`,
        { id: racers[0].id },
    );

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await display.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        ['trustytrack.displayId', 'spec-readiness-1'],
    );
    await display.goto(`/race/${raceId}/observation`);
    await display.waitForLoadState('networkidle');

    await page.goto(`/race/${raceId}/control`);

    await expect(page.getByTestId('readiness-displays')).toContainText('1 screen connected');

    await displayContext.close();
});
