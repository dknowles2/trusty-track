/**
 * Timer check: Reset and Connect Hardware Timer share a row (#1299).
 *
 * `SerialProxyConnector.test.tsx` and `TimerDiagnostics.test.tsx` cover the
 * `inline` prop's classes in isolation — jsdom lays nothing out, so neither
 * can see whether the two controls actually line up on screen. This is that
 * check: a real browser, a real proxy-mode track, and the geometry of two
 * real buttons.
 *
 * No fake timer is needed. `TimerDiagnostics.tsx`'s action row renders for
 * any track that is not FAKE/NONE regardless of the timer's own connection
 * state (`noHardware`), so a freshly created `AUTO_DETECT_PROXY` track shows
 * both buttons the moment the page loads, before anything has connected.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql } from './support';

/**
 * A fresh track name for this attempt, the same shape `timerModel.spec.ts`
 * uses (#1288): a fixed name would let a retry create a second track under
 * the same name rather than finding the first attempt's card, turning a
 * transient failure into a certain one no retry could clear.
 */
function uniqueTrackName(): string {
    return `Timer Check Row ${Math.random().toString(36).slice(2, 8)}`;
}

test('Reset and Connect Hardware Timer share a row, a height and a corner radius', async ({ page }) => {
    await ensureConfigured(page);

    const trackName = uniqueTrackName();
    const created = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation TimerCheckRowTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: trackName, laneCount: 2, timerType: 'AUTO_DETECT_PROXY' } },
    );
    const trackId = created.createTrack.id;

    try {
        await page.goto('/timer-check');
        await page.waitForLoadState('networkidle');

        // Scoped to this track's own section — `timer-check` is a page of
        // panels, one per track, and another spec's track sharing the
        // backend would otherwise give an unscoped lookup more than one
        // "Reset" button.
        const panel = page.locator('section').filter({ hasText: trackName });
        await expect(panel).toHaveCount(1);

        const resetButton = panel.getByRole('button', { name: 'Reset' });
        const connectButton = panel.getByRole('button', { name: 'Connect Hardware Timer' });
        await expect(resetButton).toBeVisible();
        await expect(connectButton).toBeVisible();

        const [resetBox, connectBox] = await Promise.all([
            resetButton.boundingBox(),
            connectButton.boundingBox(),
        ]);
        expect(resetBox).not.toBeNull();
        expect(connectBox).not.toBeNull();

        // Same row: near-enough the same top edge and the same height.
        // "Near enough" rather than exact — sub-pixel layout rounding is not
        // the bug this guards against.
        expect(Math.abs(resetBox!.y - connectBox!.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(resetBox!.height - connectBox!.height)).toBeLessThanOrEqual(2);

        // Same corner radius: `var(--border-radius)` on both, not the
        // connector's own 8px.
        const [resetRadius, connectRadius] = await Promise.all([
            resetButton.evaluate((el) => getComputedStyle(el).borderRadius),
            connectButton.evaluate((el) => getComputedStyle(el).borderRadius),
        ]);
        expect(connectRadius).toBe(resetRadius);
    } finally {
        // Cleanup swallowed deliberately: a failure above must surface as
        // itself, not be replaced by a teardown error against a page that
        // may already be gone.
        await gql(page, `mutation DeleteTimerCheckRowTrack($id: Int!) { deleteTrack(id: $id) }`, {
            id: trackId,
        }).catch(() => {});
    }
});
