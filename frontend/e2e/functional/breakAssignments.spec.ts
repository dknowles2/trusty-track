/**
 * A break and a display assignment changing at the same time (#1071, #1072).
 *
 * `intermission.spec.ts` covers the break control itself, and `displays.spec.ts`
 * covers assigning a display with no break in play — neither exercises what
 * happens when both are true at once, which is exactly the workflow a break
 * exists for: the operator has a few minutes to reconfigure the room for the
 * next phase while the countdown is up. Two bugs lived in that seam. Identify
 * did nothing on a display already showing the break overlay (#1071), and a
 * scene applied while a break was up either dropped the overlay immediately
 * (assigning the ceremony) or silently failed to take effect once the break
 * ended (an ordinary view) — `Observation.tsx`'s and `AwardCeremony.tsx`'s own
 * unit tests mock the subscription payloads directly and cannot see either
 * failure, since both are about what a real round trip does to component
 * state across a break starting and ending.
 */

import { test, expect, type Page } from '@playwright/test';
import { createSchedule, ensureConfigured, gql, seedRace } from './support';

async function openDisplay(page: Page, raceId: number, id: string) {
    await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        ['trustytrack.displayId', id],
    );
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');
}

async function startBreak(page: Page, raceId: number) {
    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('intermission-control')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('intermission-toggle').click();
    await page.getByTestId('intermission-preset-300').click();
}

async function endBreak(page: Page, raceId: number) {
    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('intermission-toggle')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('intermission-toggle').click();
    await expect(page.getByText('End now')).toBeVisible({ timeout: 15000 });
    await page.getByText('End now').click();
}

test('a plain-view scene applied during a break is what the display shows once the break ends', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Break Scene Race');
    await createSchedule(page, raceId);

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-break-scene');

    await startBreak(page, raceId);
    await expect(display.getByTestId('intermission-overlay')).toBeVisible({ timeout: 15000 });

    // The operator reconfigures the room for what comes next while the break
    // is still counting down — with one display connected, "Racing" assigns
    // it the Projector view (`domain/scenes.PRESETS`' first role).
    await page.goto(`/race/${raceId}/displays`);
    await page.getByRole('button', { name: 'Racing' }).click();

    // The break is what the room still sees — a scene applied mid-break is
    // not itself an event the break yields to (#592, #1072).
    await expect(display.getByTestId('intermission-overlay')).toBeVisible();

    await endBreak(page, raceId);

    // Only once the break ends does the scene actually take effect.
    await expect(display.getByTestId('intermission-overlay')).toHaveCount(0, { timeout: 15000 });
    await expect(display.locator('.projector-grid')).toBeVisible({ timeout: 10000 });

    await displayContext.close();
});

test('the ceremony scene applied during a break keeps the overlay up, Identify still works, and the ceremony resumes once the break ends', async ({
    browser,
    page,
}) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Break Ceremony Race');
    await createSchedule(page, raceId);

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-break-ceremony');

    await page.goto(`/race/${raceId}/displays`);
    const row = page.getByTestId('display-spec-break-ceremony');
    await expect(row).toBeVisible();

    await startBreak(page, raceId);
    await expect(display.getByTestId('intermission-overlay')).toBeVisible({ timeout: 15000 });

    // Identify still reaches a display currently showing a break (#1071) —
    // exactly the moment an operator reaches for it, to work out which
    // screen is which while reshuffling the room.
    await page.goto(`/race/${raceId}/displays`);
    await row.getByRole('button', { name: /^Identify/ }).click();
    await expect(display.getByTestId('identify-flash')).toBeVisible({ timeout: 10000 });

    // Assigning the ceremony while the break is up must not drop the
    // overlay or navigate the screen off it (#1072's own hypothesis).
    await page.getByRole('button', { name: 'Awards' }).click();
    await expect(display.getByTestId('intermission-overlay')).toBeVisible();
    await expect(display).toHaveURL(/\/observation$/);

    await endBreak(page, raceId);

    // Only once the break ends does the display carry out the ceremony
    // assignment, and it lands on a real ceremony rather than a blank page.
    await display.waitForURL('**/awards/present', { timeout: 15000 });
    await expect(display.getByText('Best Paint')).toBeVisible({ timeout: 10000 });

    await displayContext.close();
});
