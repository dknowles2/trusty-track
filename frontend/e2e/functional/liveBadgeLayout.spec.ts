/**
 * The Live page's own name badge must not cover Launch Projector Mode
 * (#954).
 *
 * `IdentifyPresence` names every screen briefly on its first payload
 * (#495) — a small badge that used to be `position: fixed; top: 76px;
 * right: 16px` unconditionally, exactly where the standard (non-projector)
 * Live view puts **Launch Projector Mode**. On a narrow screen that button
 * is also the widest control on the page, so the badge covered most of its
 * label on every load (verified by the reporter at 390×844, this file's
 * own viewport before #1144).
 *
 * The fix gives the badge a home in the flow on the standard view — a chip
 * beside the timer status pill, in whatever row the caller mounts it in,
 * with no `position` to float over anything — and leaves the fixed corner
 * for the chrome-hidden views (projector mode, a screen assigned a
 * full-screen view) that have nothing in that corner to collide with.
 *
 * **390×844 moved to `NARROW_VIEWPORT` at 650×900** (#1144): that exact
 * device size is now inside `displayDensity.ts`'s own phone tier
 * (`< 600px`), where the standard view drops **Launch Projector Mode**
 * entirely rather than merely laying the badge out beside it — so this
 * file's own regression, the badge floating over the button, is no longer
 * reachable at 390px because the button it used to float over is gone.
 * 650px keeps the same "narrower than desktop" shape the original bug
 * needed without landing inside the newer, differently-laid-out tier; a
 * second test below covers the phone tier's own, different promise (no
 * button, so nothing to collide with).
 *
 * `IdentifyPresence.test.tsx` pins the component's own two modes in
 * isolation; this is the round trip no unit test can see — a real
 * `displayAssignment` payload landing on the real page, checked at 1280px
 * too so the desktop layout this page always had is provably untouched.
 */

import { expect, test, type Page } from '@playwright/test';

import { seedRace } from './support';

const NARROW_VIEWPORT = { width: 650, height: 900 };
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

test('the identify badge does not cover Launch Projector Mode at a narrow width (#954)', async ({ page }) => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const { raceId } = await seedRace(page, 'Narrow Width Badge Race ' + Date.now());
    await checkNoCollision(page, raceId);
});

test('the identify badge does not cover Launch Projector Mode at desktop width (#954)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const { raceId } = await seedRace(page, 'Desktop Width Badge Race ' + Date.now());
    await checkNoCollision(page, raceId);
});

// #1144: the phone tier drops Launch Projector Mode entirely rather than
// merely laying the badge out beside it, so there is nothing left here for
// the badge to collide with — a different promise than the narrow/desktop
// cases above, not a version of the same one.
test('the phone tier has no Launch Projector Mode button for the badge to collide with (#1144)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, 'Phone Tier Badge Race ' + Date.now());
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('observation-standard-phone')).toBeVisible();
    await expect(page.getByRole('button', { name: /Launch Projector Mode/i })).toHaveCount(0);

    const badge = page.getByTestId('identify-connect-badge');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toBeInViewport();
});
