/**
 * The Live page's own name badge must not cover Launch Projector Mode
 * (#954).
 *
 * `IdentifyPresence` names every screen briefly on its first payload
 * (#495) — a small badge that used to be `position: fixed; top: 76px;
 * right: 16px` unconditionally, exactly where the standard (non-projector)
 * Live view puts **Launch Projector Mode**. On a phone that button is also
 * the widest control on the page, so the badge covered most of its label on
 * every load (verified by the reporter at 390×844).
 *
 * The fix gives the badge a home in the flow on the standard view — a chip
 * beside the timer status pill, in whatever row the caller mounts it in,
 * with no `position` to float over anything — and leaves the fixed corner
 * for the chrome-hidden views (projector mode, a screen assigned a
 * full-screen view) that have nothing in that corner to collide with.
 *
 * `IdentifyPresence.test.tsx` pins the component's own two modes in
 * isolation; this is the round trip no unit test can see — a real
 * `displayAssignment` payload landing on the real page, at the width the
 * bug was filed against, checked at 1280px too so the desktop layout this
 * page always had is provably untouched.
 */

import { expect, test, type Page } from '@playwright/test';

import { seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function overlaps(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function checkNoCollision(page: Page, raceId: number) {
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');

    const button = page.getByRole('button', { name: /Launch Projector Mode/i });
    await expect(button).toBeVisible();

    // Every fresh Live page gets its own default name and, with it, the
    // connect badge — wait for it rather than racing its four-second fade,
    // so the two bounding boxes below are captured while it is genuinely up.
    const badge = page.getByTestId('identify-connect-badge');
    await expect(badge).toBeVisible({ timeout: 10000 });

    const buttonBox = await button.boundingBox();
    const badgeBox = await badge.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(badgeBox).not.toBeNull();
    expect(overlaps(badgeBox as Box, buttonBox as Box)).toBe(false);

    // The label itself is the thing #954 reported as unreadable — assert it
    // is not just present but on screen and not clipped by the viewport.
    await expect(button).toContainText('Launch Projector Mode');
    await expect(button).toBeInViewport();
}

test('the identify badge does not cover Launch Projector Mode at phone width (#954)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, 'Phone Width Badge Race ' + Date.now());
    await checkNoCollision(page, raceId);
});

test('the identify badge does not cover Launch Projector Mode at desktop width (#954)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const { raceId } = await seedRace(page, 'Desktop Width Badge Race ' + Date.now());
    await checkNoCollision(page, raceId);
});
