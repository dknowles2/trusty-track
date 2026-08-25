/**
 * Assigning what an audience display shows, without walking to it (#174).
 *
 * The rules are unit-tested on both sides — `test_displays.py` for the
 * registry, `displayView.test.ts` for the precedence between an assignment and
 * the URL. What no unit test can see is the round trip this feature *is*: a
 * display registers by subscribing, the operator's list learns about it over a
 * different subscription, and the assignment travels back down the first one
 * to a screen that is already open.
 *
 * Two browser contexts, because that is the situation: the display and the
 * operator are different machines, and a display holds no PIN.
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, seedRace } from './support';

/** The display's own storage key, which is how a screen keeps its identity. */
const STORAGE_KEY = 'trustytrack.displayId';

async function openDisplay(page: Page, raceId: number, id: string) {
    // Seed the id before the app runs, so the spec knows which row is which
    // rather than having to guess from an auto-generated name.
    await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [STORAGE_KEY, id],
    );
    await page.goto(`/race/${raceId}/observation`);
    await page.waitForLoadState('networkidle');
}

test('an operator can see a display and change what it shows', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Display Assignment Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-1');

    // The operator's list learns about it without anyone adding anything.
    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-display-1');
    await expect(row).toBeVisible();

    // A name the operator will recognise, which is the point of naming at all.
    await row.getByRole('button', { name: /^Rename/ }).click();
    await row.getByPlaceholder('e.g. Gym north').fill('Gym north');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Gym north')).toBeVisible();

    // The assignment travels to a screen that is already open. Before this the
    // operator had to walk to it and edit the URL.
    await row.getByRole('combobox').selectOption('TIMING');
    await expect(display.getByRole('button', { name: /Timing Stats/i })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 10000 },
    );

    // And it can be taken back, which the URL alone could never do from here.
    await row.getByRole('combobox').selectOption('STANDINGS');
    await expect(display.getByRole('button', { name: /^Standings$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 10000 },
    );

    await displayContext.close();
});

test('a display that goes away stays listed, and can be forgotten', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Display Presence Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-2');

    await page.goto(`/race/${raceId}/control/displays`);
    await expect(page.getByTestId('display-spec-display-2')).toBeVisible();

    // Closing the tab is the only signal a screen has gone. It must not vanish
    // from the list: a projector that has dropped off the wifi is precisely
    // what the operator needs to be told about.
    await displayContext.close();
    await expect(
        page.getByTestId('display-spec-display-2').getByText('Not connected'),
    ).toBeVisible({ timeout: 10000 });

    // Only a person can decide a screen is really gone.
    await page
        .getByTestId('display-spec-display-2')
        .getByRole('button', { name: /^Forget/ })
        .click();
    await expect(page.getByTestId('display-spec-display-2')).toHaveCount(0);
});

test('an unassigned display still follows its own URL', async ({ browser, page }) => {
    // The fallback that makes this safe to add: an operator who never opens
    // the list loses nothing, and every display behaves as it did before.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Display Fallback Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await display.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [STORAGE_KEY, 'spec-display-3'],
    );
    await display.goto(`/race/${raceId}/observation?view=timing`);
    await display.waitForLoadState('networkidle');

    await expect(display.getByRole('button', { name: /Timing Stats/i })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    await displayContext.close();
});

/*
 * There is deliberately no spec here for "a viewer cannot assign a display".
 * Asserting it needs an operator PIN set on this backend, which every other
 * spec shares — and if the cleanup ever failed, every one of their mutations
 * would start being refused for reasons none of them could explain. The rule
 * is pinned in `test_auth_policy.py::test_a_viewer_cannot_assign_a_display`,
 * which is where the rest of the role policy is tested anyway.
 */

test('a screen sent to the awards ceremony can still be called back', async ({ browser, page }) => {
    // The reported bug: assigning the ceremony navigated the screen to its
    // own route, which held no assignment subscription — so the row dropped
    // to "Not connected" and the screen could never be told anything again.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Leash Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-3');

    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-display-3');
    await expect(row).toBeVisible();

    await row.getByRole('combobox').selectOption('AWARDS');
    await display.waitForURL('**/awards/present', { timeout: 10000 });

    // The row must not go quiet while the ceremony is up — the subscription
    // is presence, and presence is what lets the operator take it back.
    await expect(row.getByText('Not connected')).not.toBeVisible();

    await row.getByRole('combobox').selectOption('STANDINGS');
    await display.waitForURL('**/observation', { timeout: 10000 });
    await expect(display.getByRole('button', { name: /^Standings$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 10000 },
    );

    await displayContext.close();
});
