/**
 * The Race tab's action row on a desktop (#1157).
 *
 * Five controls in `justify-content: space-between` used to be squeezed to
 * their minimum width at 1440px and 1280px, wrapping a two-word label
 * ("Skip Heat", "Sound options") onto two lines inside its own button. The
 * fix is a footer with two groups (secondary actions on the left, one
 * primary Next Heat on the right) instead of five loose flex children, plus
 * `white-space: nowrap` on every button in the row — see `index.css` and
 * `RaceExecution.tsx`'s own `data-testid="race-execution-action-row"`.
 *
 * `shortcuts.spec.ts` already covers the keyboard side of this row and is
 * unaffected — the keys did not move, only where their buttons sit.
 *
 * **Why the wrap check walks text nodes and not `boundingBox().height`.**
 * Every button here carries an explicit inline `height: '36px'` (unrelated
 * to this fix — it has always sized these buttons), so a wrapped label does
 * not grow the button's own box at all; the second line renders past the
 * fixed height instead. `boundingBox().height < 2 × line-height` reads as
 * passing either way and would not have caught the bug this spec exists
 * for — confirmed by mutation (temporarily restoring the pre-#1157 shape:
 * every control a direct sibling of one `nowrap`/`space-between` row, the
 * `white-space: nowrap` rule disabled, and the row narrowed so the content
 * genuinely overflows), which left every button's `boundingBox()` at its
 * normal 36px while three of them visibly wrapped.
 *
 * A first attempt at a geometry-based check — a `Range` over the whole
 * button's content, checking its `getClientRects()` all share one `top` —
 * also failed, the other way: it *passed* under that same mutation and
 * *failed* on the real, already-fixed page, because the range also covers
 * the icon `<svg>` and the `<kbd>` hint, and their own boxes sit at a
 * slightly different `top` than the label text purely from `align-items:
 * center` rounding — a false positive with no bug behind it. Walking only
 * the button's own text nodes and checking *each one's* rects share a `top`
 * sidesteps that: an icon or a `<kbd>` never enters the comparison, and a
 * genuine wrap still shows up as one text node's rects landing a full
 * line-height apart.
 */

import { expect, test } from '@playwright/test';

import { createSchedule, ensureConfigured, seedRace } from './support';

const DESKTOP_VIEWPORTS = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1280x720', width: 1280, height: 720 },
];

// Same 390×844 phone size other mobile specs use (`liveBadgeLayout.spec.ts`,
// `mobileNav.spec.ts`, `mobileStats.spec.ts`, `formFieldBoxSizing.spec.ts`).
const PHONE_VIEWPORT = { width: 390, height: 844 };

for (const viewport of DESKTOP_VIEWPORTS) {
    test.describe(`action row at ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('every button in the action row is one line tall, and Next Heat is present-and-disabled before a result', async ({ page }) => {
            await ensureConfigured(page);
            const { raceId } = await seedRace(page, `Action Row ${viewport.name} ${Date.now()}`);
            await createSchedule(page, raceId);

            await page.goto(`/race/${raceId}/control/race`);

            const actionRow = page.getByTestId('race-execution-action-row');
            await expect(actionRow).toBeVisible({ timeout: 30000 });

            // Next Heat exists from the first render — disabled rather than
            // replaced by a "Waiting for Timer…" status box — and stays
            // disabled until this heat actually has a result.
            const nextHeat = page.getByTestId('next-heat-button');
            await expect(nextHeat).toBeVisible();
            await expect(nextHeat).toBeDisabled();

            // Every button in the row renders its label on one line — see
            // this file's own header comment for why that is checked by
            // walking the button's own text nodes rather than its bounding
            // box or a whole-content `Range`.
            const buttons = actionRow.locator('button');
            const count = await buttons.count();
            expect(count).toBeGreaterThan(0);
            for (let i = 0; i < count; i++) {
                const button = buttons.nth(i);
                const wrapped = await button.evaluate((el) => {
                    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                        if (!node.textContent || !node.textContent.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const tops = new Set(
                            Array.from(range.getClientRects())
                                .filter((r) => r.width > 0 && r.height > 0)
                                .map((r) => Math.round(r.top)),
                        );
                        if (tops.size > 1) return true;
                    }
                    return false;
                });
                expect(wrapped, `button "${await button.innerText()}" wrapped its label`).toBe(false);
            }

            // Run the heat through the fake timer, the same as
            // `shortcuts.spec.ts`'s own `runCurrentHeat` — once it has a
            // result, Next Heat becomes the one enabled primary action.
            await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
            await page.getByRole('button', { name: 'Start Timer' }).click();
            await page.getByRole('button', { name: 'Finish Heat' }).click();

            await expect(nextHeat).toBeEnabled({ timeout: 30000 });
        });

        test('the ⚙ popover opens and switches the lane-photo picker (#1245)', async ({ page }) => {
            await ensureConfigured(page);
            const { raceId } = await seedRace(page, `Preferences Popover ${viewport.name} ${Date.now()}`);
            await createSchedule(page, raceId);

            await page.goto(`/race/${raceId}/control/race`);
            await expect(page.getByTestId('race-execution-action-row')).toBeVisible({ timeout: 30000 });

            const picker = page.getByTestId('lane-photo-picker');
            await expect(picker).toHaveCount(0);

            await page.getByTestId('race-execution-preferences-trigger').click();
            await expect(page.getByTestId('race-execution-preferences-popover')).toBeVisible();

            const carOption = page.getByTestId('lane-photo-option-car');
            const portraitOption = page.getByTestId('lane-photo-option-portrait');
            await expect(carOption).toHaveAttribute('aria-checked', 'true'); // Car is the default (#1075).
            await expect(portraitOption).toHaveAttribute('aria-checked', 'false');

            await portraitOption.click();
            await expect(portraitOption).toHaveAttribute('aria-checked', 'true');
            await expect(carOption).toHaveAttribute('aria-checked', 'false');
        });

        // #1246 reverses #1074: Override used to be muted, underlined text
        // with no border or background — a link between two buttons rather
        // than one of the row's own actions. It is `secondary-btn` now, the
        // same shape Skip Heat beside it already carries.
        test('Override reads as a button beside Skip Heat, not a text link (#1246)', async ({ page }) => {
            await ensureConfigured(page);
            const { raceId } = await seedRace(page, `Action Row Override ${viewport.name} ${Date.now()}`);
            await createSchedule(page, raceId);

            await page.goto(`/race/${raceId}/control/race`);
            await expect(page.getByTestId('race-execution-action-row')).toBeVisible({ timeout: 30000 });

            const override = page.getByRole('button', { name: 'Override', exact: true });
            const skipHeat = page.getByRole('button', { name: /Skip Heat/ });
            await expect(override).toBeVisible();
            await expect(skipHeat).toBeVisible();

            const [overrideBox, skipBox] = await Promise.all([override.boundingBox(), skipHeat.boundingBox()]);
            expect(overrideBox).not.toBeNull();
            expect(skipBox).not.toBeNull();
            expect(Math.abs(overrideBox!.height - skipBox!.height)).toBeLessThanOrEqual(2);

            const style = await override.evaluate((el) => {
                const computed = getComputedStyle(el);
                return {
                    textDecorationLine: computed.textDecorationLine,
                    backgroundColor: computed.backgroundColor,
                    borderWidth: computed.borderTopWidth,
                };
            });
            expect(style.textDecorationLine).toBe('none');
            const hasVisibleBackground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
            const hasVisibleBorder = parseFloat(style.borderWidth) > 0;
            expect(hasVisibleBackground || hasVisibleBorder, `Override's computed style had neither a visible background nor a visible border: ${JSON.stringify(style)}`).toBe(true);
        });
    });
}

test('the lane-photo picker fits inside the ⚙ popover on a 390px phone (#1245)', async ({ page }) => {
    // The popover itself is a fixed 240px wide (`RaceExecution.tsx`'s
    // `minWidth`) regardless of viewport — a segmented control with two
    // named buttons is wider than the switch it replaced, so this pins
    // that it still fits rather than pushing the popover into horizontal
    // scroll.
    await page.setViewportSize(PHONE_VIEWPORT);
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, `Preferences Popover Phone ${Date.now()}`);
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('race-execution-action-row')).toBeVisible({ timeout: 30000 });

    await page.getByTestId('race-execution-preferences-trigger').click();
    const popover = page.getByTestId('race-execution-preferences-popover');
    await expect(popover).toBeVisible();

    const picker = page.getByTestId('lane-photo-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('lane-photo-option-car')).toBeVisible();
    await expect(page.getByTestId('lane-photo-option-portrait')).toBeVisible();

    // Sound options… (#1247) is a full-width menu row below a divider, at
    // the foot of the same 240px popover — it has to fit on this phone
    // width too, not just the lane-picture picker above.
    const soundOptions = page.getByTestId('sound-effects-modal-trigger');
    await expect(soundOptions).toBeVisible();
    await expect(soundOptions).toHaveAccessibleName('Sound options…');

    const overflow = await popover.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
});

// #1246: Override picked up `secondary-btn`, so it now carries the same
// width/wrap rules as every other classed button in this row at the phone
// width — reusing this file's own text-node-rects technique (see the
// header comment) rather than `boundingBox().height`.
test('Override does not wrap its label on a 390px phone, and the action row does not overflow (#1246)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await ensureConfigured(page);
    const { raceId } = await seedRace(page, `Action Row Override Phone ${Date.now()}`);
    await createSchedule(page, raceId);

    await page.goto(`/race/${raceId}/control/race`);
    await expect(page.getByTestId('race-execution-action-row')).toBeVisible({ timeout: 30000 });

    const override = page.getByRole('button', { name: 'Override', exact: true });
    await expect(override).toBeVisible();

    const wrapped = await override.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent || !node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const tops = new Set(
                Array.from(range.getClientRects())
                    .filter((r) => r.width > 0 && r.height > 0)
                    .map((r) => Math.round(r.top)),
            );
            if (tops.size > 1) return true;
        }
        return false;
    });
    expect(wrapped, "Override wrapped its label at 390px").toBe(false);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, 'the action row overflowed horizontally at 390px').toBe(false);
});
