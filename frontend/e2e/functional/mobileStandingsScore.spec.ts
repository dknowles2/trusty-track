/**
 * Standings on a phone: the score column itself (#1138).
 *
 * `mobileStandingsAndAwards.spec.ts` (#950) gave the Standings table a
 * horizontal scroll wrapper so a phone could *reach* every column rather
 * than have them clipped outright — a real fix, but it still left the
 * score (Avg Time / Points) sitting off the right edge of a 390px screen
 * with no cue that scrolling would reach it. This file is the harder bar:
 * at phone width, Avatar / Den / Heats are dropped from the table
 * (`Leaderboard.css`'s `@media (max-width: 600px)` rules) so the remaining
 * Rank / Car# / Name / Score columns fit without any scrolling at all, and
 * the round `<select>` plus the two action buttons stack into one column
 * instead of wrapping and clipping.
 */

import { expect, test } from '@playwright/test';

import { createSchedule, ensureConfigured, readHeats, recordRound, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

test('the score cell of row 1 is on screen with no scrolling needed, on a 390px phone (#1138)', async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Mobile Standings Score ' + Date.now());
    await createSchedule(page, raceId);
    await ensureConfigured(page);

    const heats = await readHeats(page, raceId);
    await recordRound(page, heats, racers);

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/standings`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('columnheader', { name: 'Rank' })).toBeVisible();

    // The document itself must not be forced wider by the table (#950's own
    // check, still true here).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width + 2);

    // The score column (TIMED here, so "Avg Time") must be visible — not
    // merely reachable by scrolling.
    const scoreHeader = page.getByRole('columnheader', { name: /Avg Time|Points/ });
    await expect(scoreHeader).toBeVisible();

    // The score *cell* of the first data row — the exact symptom #1138
    // reported: the score was the column pushed off-screen, with the
    // visible part of the table ending at Den.
    const firstRow = page.locator('tbody tr').first();
    const scoreCell = firstRow.locator('td').last();
    await expect(scoreCell).toBeVisible();
    const scoreBox = await scoreCell.boundingBox();
    expect(scoreBox).not.toBeNull();
    expect(scoreBox!.x + scoreBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
    expect(scoreBox!.x).toBeGreaterThanOrEqual(0);

    // Avatar, Den and Heats are the three columns #1138 asked to drop at
    // this width, in that order — dropped, not merely scrolled out of
    // reach. `getByRole('columnheader', ...)` excludes anything
    // `display: none`, so these being unreachable here is the assertion.
    await expect(page.getByRole('columnheader', { name: 'Avatar' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Den' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Heats' })).toHaveCount(0);

    // "Print results" — clipped at the right edge before this fix — is
    // now fully inside the viewport.
    const printBtn = page.getByTestId('print-results');
    await expect(printBtn).toBeVisible();
    const printBox = await printBtn.boundingBox();
    expect(printBox).not.toBeNull();
    expect(printBox!.x).toBeGreaterThanOrEqual(0);
    expect(printBox!.x + printBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
});
