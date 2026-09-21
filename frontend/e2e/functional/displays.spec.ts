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
import { ensureConfigured, gql, seedRace, trackPoolName } from './support';

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
    await page.goto(`/race/${raceId}/displays`);
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

test('scenes are disabled with a reason until a display connects (#850)', async ({ browser, page }) => {
    // The reported bug: the Scenes panel led with five live-looking buttons
    // that silently did nothing with nothing connected, above the empty
    // state that actually answers "how do I get a screen onto this list".
    // `DisplaysPanel` and `ScenesPanel` each have their own unit coverage for
    // what they render given a boolean; this is the wiring between them —
    // `RaceControl.tsx` reading one panel's own answer into the other's
    // `disabled` prop — that only a real page can exercise.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Scenes Disabled Race');

    await page.goto(`/race/${raceId}/displays`);

    // The connect panel is what is actually there while nothing is
    // connected, and Scenes has nothing yet to apply to.
    await expect(page.getByText('No audience displays are open yet.')).toBeVisible();

    const racing = page.getByRole('button', { name: 'Racing' });
    await expect(racing).toBeDisabled();
    await expect(page.getByText(/connect a screen first/i)).toBeVisible();

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-scenes');

    await expect(page.getByTestId('display-spec-display-scenes')).toBeVisible();
    await expect(racing).toBeEnabled({ timeout: 10000 });
    await expect(page.getByText(/connect a screen first/i)).not.toBeVisible();

    await displayContext.close();
});

test('a display that goes away stays listed, and can be forgotten', async ({ browser, page }) => {
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Display Presence Race');

    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await openDisplay(display, raceId, 'spec-display-2');

    await page.goto(`/race/${raceId}/displays`);
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

    await page.goto(`/race/${raceId}/displays`);
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
    await page.goto(`/race/${raceId}/displays`);
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    await first.close();
    await second.close();
});

test('the operator can open a second display window with one click', async ({ page, context }) => {
    // The Displays panel's own launcher (#590, renamed by #1249): a fresh id
    // baked into the URL, so the new window is a distinct screen from the
    // moment it opens rather than briefly contending with this tab's own
    // claim on the shared device id.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Open New Display Race');

    await page.goto(`/race/${raceId}/displays`);
    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('button', { name: 'Add a second screen on this computer' }).click(),
    ]);
    await popup.waitForLoadState('networkidle');
    expect(popup.url()).toContain(`/race/${raceId}/observation?displayId=`);

    await expect(page.locator('[data-testid^="display-"]')).toHaveCount(1, { timeout: 10000 });

    await popup.close();
});

test('the launch area keeps its two headings and fits a phone screen with no horizontal overflow (#1249)', async ({ page }) => {
    // #1249 replaced three look-alike buttons with two headed sections —
    // "This computer" (Open Live here, plus the second-screen escape hatch)
    // and "Other devices" (the shareable address) — specifically so the
    // panel reads correctly on the narrow screen a volunteer is likely
    // reading it on at the check-in table.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Displays Heading Race');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/race/${raceId}/displays`);

    // <h2>: DisplaysPage.tsx has no <h2> of its own between its <h1> and
    // this panel, matching the level SystemSettings.tsx/RaceDetails.tsx use
    // for a section under a page <h1> — pinned so a future edit can't
    // quietly drop back a level.
    await expect(page.getByRole('heading', { name: 'This computer', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other devices', level: 2 })).toBeVisible();

    const fitsWithoutOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fitsWithoutOverflow).toBe(true);
});

test('the Connect a screen and Connect a camera cards line up as a pair (#1292)', async ({ page }) => {
    // #1292: the two cards used to have different tops, different-height
    // address rows and QR codes at different heights, because content that
    // belonged to one card (a picker, an empty-state line) rendered outside
    // it. Both cards now go through the same `ConnectDisplayAddress`
    // component and the same `.connect-devices-row` grid — this is the
    // round trip that proves it, in a real layout no unit test renders.
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, 'Connect Devices Alignment Race');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/race/${raceId}/displays`);

    const screenBlock = page.getByTestId('connect-screen-address');
    const cameraBlock = page.getByTestId('connect-camera-address');
    await expect(screenBlock).toBeVisible();
    await expect(cameraBlock).toBeVisible();

    const screenQr = screenBlock.locator('img');
    const cameraQr = cameraBlock.locator('img');
    await expect(screenQr).toBeVisible();
    await expect(cameraQr).toBeVisible({ timeout: 15000 });

    const screenBox = await screenBlock.boundingBox();
    const cameraBox = await cameraBlock.boundingBox();
    expect(screenBox).not.toBeNull();
    expect(cameraBox).not.toBeNull();
    expect(Math.abs(screenBox!.y - cameraBox!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenBox!.height - cameraBox!.height)).toBeLessThanOrEqual(2);

    const screenQrBox = await screenQr.boundingBox();
    const cameraQrBox = await cameraQr.boundingBox();
    expect(screenQrBox).not.toBeNull();
    expect(cameraQrBox).not.toBeNull();
    expect(Math.abs(screenQrBox!.y - cameraQrBox!.y)).toBeLessThanOrEqual(2);

    // Below 768px the pair stacks — the camera card (added second, after
    // the screen card in DOM order) ends up below it, and the page never
    // grows wider than its own viewport.
    //
    // #1313: `.connect-devices-row`'s own grid collapse to one column is
    // plain CSS, synchronous with the resize — but everything above this
    // pair that changes shape at 768px does so through React state set from
    // a `resize` *listener*, not from the resize itself: `Navigation`'s
    // desktop row becoming the mobile pill and bottom tab bar, and
    // `RaceViewHeading` hiding its `<h1>` (`useNarrowViewport`).
    // `setViewportSize` fires the event and returns; the grid has already
    // collapsed by the next frame, but the height those swaps free up above
    // the pair lands on whichever render the listeners' `setState` calls
    // happen to trigger. A `boundingBox()` read taken in that window can
    // catch the pair still sitting at its taller, pre-swap position (the
    // issue measured a transient y of 623.14 against a steady-state 553.14;
    // the real failures were 70–90px off in the same shape). Poll the gap
    // between the two cards until it has settled rather than reading once.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(screenBlock).toBeVisible();
    await expect(cameraBlock).toBeVisible();
    await expect
        .poll(async () => {
            const s = await screenBlock.boundingBox();
            const c = await cameraBlock.boundingBox();
            return s && c ? c.y - (s.y + s.height) : null;
        })
        .toBeGreaterThan(-2);

    const fitsWithoutOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fitsWithoutOverflow).toBe(true);
});

test('the Connect a camera code carries this race\'s own track, and scanning it shows a camera row listening to that track (#1254, #1293)', async ({ browser, page }) => {
    // The reported bug: connecting a camera meant editing a URL on a phone
    // keyboard, because the Displays panel's only QR code landed on the
    // Live page. `ConnectDisplayAddress`'s own `path` prop and
    // `cameraWindowUrl` are unit-tested on their own; this is the round
    // trip no unit test can see — the address actually shown on the panel
    // opens `/camera`, and connecting through it reaches the operator's
    // own list with the track preset already applied.
    await ensureConfigured(page);
    const { raceId, trackId } = await seedRace(page, 'Camera Connect Race');

    await page.goto(`/race/${raceId}/displays`);
    const cameraBlock = page.getByTestId('connect-camera-address');
    await expect(cameraBlock).toBeVisible();

    // Read the block's own address rather than trusting the component's
    // internals — the same "read it, then follow it" shape
    // `instantReplay.spec.ts` uses for FakeCamera. The block renders
    // immediately, before the track-preset queries have necessarily
    // answered, so wait for the preset to actually be in the text rather
    // than reading it the instant the block appears.
    const cameraCode = cameraBlock.locator('code');
    await expect(cameraCode).toContainText('trackId=', { timeout: 10000 });
    const cameraUrlText = (await cameraCode.textContent())?.trim() ?? '';
    const cameraUrl = new URL(cameraUrlText);
    expect(cameraUrl.pathname).toBe(`/race/${raceId}/camera`);
    expect(cameraUrl.searchParams.get('trackId')).toBe(String(trackId));
    const cameraDisplayId = cameraUrl.searchParams.get('displayId');
    expect(cameraDisplayId).toBeTruthy();

    // The QR code itself, not just the address text beside it (#1282): the
    // backend's QR guard silently refused a `/camera` target, and the
    // block's own `onError` handler just hid the broken `<img>`, so the
    // address and Copy button looked complete with no code ever drawn.
    //
    // `expect.poll`, not a single `evaluate` — the QR PNG comes from the
    // backend's own `/api/printables/vote-qr/...` route, and a plain
    // `naturalWidth` read has no tolerance for that response being merely
    // slow. Run 35554616738 caught exactly this: under a busy shard, both
    // this image's request *and* the screen block's own (below — the same,
    // unmodified component, so it is not specific to the camera target)
    // sat with no recorded response for the whole ~34s the trace covers,
    // failing a same-tick `naturalWidth` check three times running though
    // nothing was actually wrong. Polling still catches the real bug this
    // check exists for (#1282's guard refusing `/camera`): a refused
    // request's `naturalWidth` never becomes positive, so `expect.poll`
    // still fails, just at its own timeout rather than instantly.
    const cameraQr = cameraBlock.locator('img');
    await expect(cameraQr).toBeVisible();
    await expect
        .poll(() => cameraQr.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 })
        .toBeGreaterThan(0);

    // The screen block shares the same component and the same guard, so it
    // gets the same check here rather than being taken on faith.
    const screenBlock = page.getByTestId('connect-screen-address');
    const screenQr = screenBlock.locator('img');
    await expect(screenQr).toBeVisible();
    await expect
        .poll(() => screenQr.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 })
        .toBeGreaterThan(0);

    // A second machine, with `&fake=1` appended so no real camera is
    // needed — the same flag `FakeCamera` uses throughout the instant
    // replay suite.
    const cameraContext = await browser.newContext();
    const cameraTab = await cameraContext.newPage();
    await cameraTab.goto(`${cameraUrl.pathname}${cameraUrl.search}&fake=1`);
    await cameraTab.waitForLoadState('networkidle');

    await page.goto(`/race/${raceId}/displays`);
    const row = page.getByTestId(`display-${cameraDisplayId}`);
    await expect(row).toBeVisible({ timeout: 10000 });
    // A race runs on exactly one track (#1293) — the row is a read-only
    // line naming it, not a picker.
    const trackName = trackPoolName(test.info().parallelIndex);
    await expect(row.getByText(`Listening to ${trackName}`)).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('combobox')).toHaveCount(0);

    await cameraContext.close();
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

    await page.goto(`/race/${raceId}/displays`);
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

    await page.goto(`/race/${raceId}/displays`);
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

    await page.goto(`/race/${raceId}/displays`);
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

    await page.goto(`/race/${raceId}/displays`);
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
    await page.goto(`/race/${raceId}/displays`);
    await expect(row.getByRole('combobox')).toContainText('Awards ceremony');

    await displayContext.close();
});
