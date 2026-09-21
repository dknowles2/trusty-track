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

/**
 * The connected badge and the unsupported notice, the two other states the
 * row can show — a real event spends most of its time in the connected one,
 * once the operator has plugged the timer in.
 *
 * Reaching an actually-`connected` `SerialProxyConnector` from here means the
 * *browser's* `navigator.serial` granting a port, which needs either a real
 * device or a mocked Web Serial API — `screenshot-timers.spec.ts`'s
 * `FakeMicroWizard` sidesteps that by dialling the backend's `/ws/timer/`
 * WebSocket directly, impersonating the proxy session rather than the
 * button click that opens one, which is why that spec's own "Ready" picture
 * still shows the *disconnected* button: the frontend's own `useSerialProxy`
 * status never left `'disconnected'`.
 *
 * So this measures the real, compiled CSS the same way the test above does,
 * against fixture markup carrying the connector's own classes — the same
 * technique used to confirm the fix before writing this test — rather than
 * mocking `navigator.serial` just to get two `<div>`s onto the page.
 */
test("the connected badge and the unsupported notice share Reset's geometry too", async ({ page }) => {
    await ensureConfigured(page);

    const trackName = uniqueTrackName();
    const created = await gql<{ createTrack: { id: number } }>(
        page,
        `mutation TimerCheckRowTrack2($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: trackName, laneCount: 2, timerType: 'AUTO_DETECT_PROXY' } },
    );
    const trackId = created.createTrack.id;

    try {
        await page.goto('/timer-check');
        await page.waitForLoadState('networkidle');

        const panel = page.locator('section').filter({ hasText: trackName });
        await expect(panel).toHaveCount(1);

        const resetButton = panel.getByRole('button', { name: 'Reset' });
        await expect(resetButton).toBeVisible();
        await resetButton.evaluate((el) => el.setAttribute('data-timer-check-reset-fixture', '1'));

        // Appends the connected badge and the unsupported notice as real
        // siblings of Reset, inside its own row — the exact markup and
        // classes `SerialProxyConnector` renders for `status === 'connected'`
        // and `!isSupported` with `inline` — so they're laid out under the
        // same cascade (`SerialProxyConnector.css`, already loaded by this
        // page) that produced the bug.
        const geometry = await panel.evaluate((panelEl) => {
            const resetEl = panelEl.querySelector(
                '[data-timer-check-reset-fixture]',
            ) as HTMLElement;
            const row = resetEl.parentElement as HTMLElement;

            const connected = document.createElement('div');
            connected.className = 'proxy-connector-status connected proxy-connector-status--inline';
            connected.innerHTML = '<span>Hardware Timer Proxy Active</span>';
            row.appendChild(connected);

            const unsupported = document.createElement('div');
            unsupported.className =
                'proxy-connector-unsupported proxy-connector-unsupported--inline';
            unsupported.innerHTML = '<span>Web Serial not supported. Use Chrome or Edge.</span>';
            row.appendChild(unsupported);

            const resetStyle = getComputedStyle(resetEl);
            const connectedStyle = getComputedStyle(connected);
            const unsupportedStyle = getComputedStyle(unsupported);

            return {
                resetHeight: resetEl.getBoundingClientRect().height,
                connectedHeight: connected.getBoundingClientRect().height,
                resetBorderRadius: resetStyle.borderRadius,
                connectedBorderRadius: connectedStyle.borderRadius,
                connectedCursor: connectedStyle.cursor,
                connectedMarginBottom: connectedStyle.marginBottom,
                unsupportedFlexBasis: unsupportedStyle.flexBasis,
                unsupportedMarginBottom: unsupportedStyle.marginBottom,
            };
        });

        // Same height and corner radius as Reset — the "4px off in height,
        // different radius" the reviewer measured on the pre-fix badge.
        expect(Math.abs(geometry.resetHeight - geometry.connectedHeight)).toBeLessThanOrEqual(2);
        expect(geometry.connectedBorderRadius).toBe(geometry.resetBorderRadius);

        // A status, not a button: no pointer cursor, no leftover
        // `margin-bottom` pushing it 8px above Reset's centre line.
        expect(geometry.connectedCursor).toBe('default');
        expect(geometry.connectedMarginBottom).toBe('0px');

        // No button exists in the unsupported state, so — like the inline
        // error notice — it drops onto its own line beneath the row rather
        // than squeezing in beside Reset.
        expect(geometry.unsupportedFlexBasis).toBe('100%');
        expect(geometry.unsupportedMarginBottom).toBe('0px');
    } finally {
        await gql(page, `mutation DeleteTimerCheckRowTrack2($id: Int!) { deleteTrack(id: $id) }`, {
            id: trackId,
        }).catch(() => {});
    }
});
