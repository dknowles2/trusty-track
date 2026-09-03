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
import { ensureConfigured, gql, seedRace } from './support';

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

test('two windows on the same computer register as two distinct displays', async ({ page, context }) => {
    // The reported bug (#590): every tab on one computer shares its
    // `localStorage`, so two monitors plugged into the same operator's
    // laptop reported the identical id and an assignment moved both at
    // once. `context.newPage()` rather than `browser.newContext()` is the
    // point of this spec — a new *context* starts with empty storage of its
    // own, which is a different machine as far as this feature is
    // concerned, and every other spec in this file uses one for exactly
    // that reason. Sharing the context is what makes this the actual
    // situation being fixed, with neither window told which id to use.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Same Computer Displays Race');

    const first = await context.newPage();
    await first.goto(`/race/${raceId}/observation`);
    await first.waitForLoadState('networkidle');

    const second = await context.newPage();
    await second.goto(`/race/${raceId}/observation`);
    await second.waitForLoadState('networkidle');

    await page.goto(`/race/${raceId}/control/displays`);
    const rows = page.locator('[data-testid^="display-"]');
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    // Assigning the first row must move exactly one window, not both.
    await rows.nth(0).getByRole('combobox').selectOption('TIMING');
    await expect
        .poll(
            async () => {
                const firstPressed = await first
                    .getByRole('button', { name: /Timing Stats/i })
                    .getAttribute('aria-pressed');
                const secondPressed = await second
                    .getByRole('button', { name: /Timing Stats/i })
                    .getAttribute('aria-pressed');
                return [firstPressed, secondPressed].filter((pressed) => pressed === 'true').length;
            },
            { timeout: 10000 },
        )
        .toBe(1);

    // A reload keeps a window's own identity — it neither becomes a third
    // display nor swaps places with the other window.
    await second.reload();
    await second.waitForLoadState('networkidle');
    await page.goto(`/race/${raceId}/control/displays`);
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    await first.close();
    await second.close();
});

test('the operator can open a second display window with one click', async ({ page, context }) => {
    // Race Control's own launcher (#590): a fresh id baked into the URL, so
    // the new window is a distinct screen from the moment it opens rather
    // than briefly contending with this tab's own claim on the shared
    // device id.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Open New Display Race');

    await page.goto(`/race/${raceId}/control/displays`);
    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('button', { name: 'Open a new display window' }).click(),
    ]);
    await popup.waitForLoadState('networkidle');
    expect(popup.url()).toContain(`/race/${raceId}/observation?displayId=`);

    await expect(page.locator('[data-testid^="display-"]')).toHaveCount(1, { timeout: 10000 });

    await popup.close();
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

    // An award, because the ceremony is not offered as a view for a race with
    // nothing to announce.
    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

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

test('an operator can drive the ceremony on a screen across the room', async ({ browser, page }) => {
    // The ceremony is paced by a person, and that person was required to be
    // standing at the screen — the one place the operator is not, having just
    // assigned it from the Displays panel.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Remote Race');

    // Two awards, so there is somewhere to advance to.
    for (const name of ['Fastest Car', 'Best Paint']) {
        await gql(
            page,
            `mutation Award($raceId: Int!, $award: AwardInput!) {
                createAward(raceId: $raceId, award: $award) { id }
            }`,
            { raceId, award: { name, kind: 'SPECIAL' } },
        );
    }

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-4');

    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-display-4');
    await expect(row).toBeVisible();

    await row.getByRole('combobox').selectOption('AWARDS');
    await display.waitForURL('**/awards/present', { timeout: 10000 });
    await expect(display.getByText('1 of 2')).toBeVisible({ timeout: 10000 });

    // The step travels to a screen nobody is standing at.
    await row.getByRole('button', { name: /Next award/ }).click();
    await expect(display.getByText('2 of 2')).toBeVisible({ timeout: 10000 });

    await row.getByRole('button', { name: /Previous award/ }).click();
    await expect(display.getByText('1 of 2')).toBeVisible({ timeout: 10000 });

    await displayContext.close();
});

test('Identify reaches a screen showing the awards ceremony', async ({ browser, page }) => {
    // The reported bug (#519): the ceremony is its own route with its own
    // `displayAssignment` subscription (#174, for the leash), so it received
    // the identify counter over the wire and dropped it on the floor —
    // `AwardCeremony.tsx` knew nothing about `identifySeq`. A unit test on
    // that page alone would pass against the treatment being merely absent;
    // this is the round trip the bug report itself specified: assign a
    // screen to the ceremony, press Identify from the operator's page, and
    // assert the flash appears on the audience page.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Identify Race');

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Best Paint', kind: 'SPECIAL' } },
    );

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-6');

    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-display-6');
    await expect(row).toBeVisible();

    await row.getByRole('combobox').selectOption('AWARDS');
    await display.waitForURL('**/awards/present', { timeout: 10000 });

    await row.getByRole('button', { name: /^Identify/ }).click();
    await expect(display.getByTestId('identify-flash')).toBeVisible({ timeout: 10000 });

    await displayContext.close();
});

test('the ceremony is offered only once the race has awards', async ({ browser, page }) => {
    // The reported bug: every race offered "Awards ceremony", and choosing it
    // for a race with no awards sent the screen to a page whose only content
    // was a line saying there was nothing to announce.
    //
    // End to end because the interesting half is freshness: the panel has to
    // notice an award added a moment ago on another page, which is a cache
    // question no unit test can answer.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Ceremony Offer Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-5');

    await page.goto(`/race/${raceId}/control/displays`);
    const row = page.getByTestId('display-spec-display-5');
    await expect(row).toBeVisible();
    await expect(row.getByRole('combobox')).not.toContainText('Awards ceremony');

    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Judges’ Choice', kind: 'SPECIAL' } },
    );

    // Coming back to the tab is what re-reads it, which is the operator's own
    // order: set the awards up, then put the ceremony on a screen.
    await page.goto(`/race/${raceId}/control/schedule`);
    await page.goto(`/race/${raceId}/control/displays`);
    await expect(row.getByRole('combobox')).toContainText('Awards ceremony');

    await displayContext.close();
});
