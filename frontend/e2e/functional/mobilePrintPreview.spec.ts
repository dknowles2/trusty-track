/**
 * The print page's sheet preview on a phone (#1142).
 *
 * `/race/:raceId/print` sizes every sheet in inches to match the printed
 * page exactly (`documents.ts`), which is why none of them ever fit a phone
 * on their own — a pit-pass sheet is about 730px wide, centred in a 390px
 * page, so the sheet's own left edge sits off the left of the viewport with
 * no way to scroll back to it (the issue's own "first column is cut off and
 * unreachable"). `useSheetScale.ts` shrinks the preview with a CSS
 * `transform` to fit whatever width the page actually has, reserving the
 * scaled height so the controls above it and nothing below overlaps it.
 *
 * `printHub.spec.ts` is the shape this follows: seed through the API, drive
 * one screen with a real browser, and measure the geometry directly.
 */

import { expect, test } from '@playwright/test';
import { seedRace } from './support';
import { specFor } from '../../src/features/printables/documents';

const PHONE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// The same half-hand gap `PrintSheet.css`'s own `.print-sheets` rule uses
// between columns.
const CARD_GAP_IN = 0.125;
const PX_PER_IN = 96;

/** The sheet's own natural, unscaled width — the same arithmetic
 * `documents.ts`'s `perSheet` and `PrintSheet.css`'s grid columns both
 * already encode, recomputed here rather than imported so this spec fails
 * loudly if either one changes shape out from under it. */
function naturalWidthPx(kind: string): number {
    const spec = specFor(kind);
    return (spec.widthIn * spec.columns + CARD_GAP_IN * (spec.columns - 1)) * PX_PER_IN;
}

/** Same as `naturalWidthPx`, but on paper — `PrintSheet.css`'s own
 * `@media print` rule zeroes the gap between cards (trimmed cards butt up),
 * so the printed sheet is narrower by that much than the screen preview. */
function naturalPrintWidthPx(kind: string): number {
    const spec = specFor(kind);
    return spec.widthIn * spec.columns * PX_PER_IN;
}

for (const kind of ['pit-pass', 'check-in-code']) {
    test(`the ${kind} sheet fits a 390px phone, and the first card is reachable (#1142)`, async ({
        page,
    }) => {
        const { raceId } = await seedRace(page, `Mobile Print Preview ${kind}`);
        await page.setViewportSize(PHONE_VIEWPORT);
        await page.goto(`/race/${raceId}/print?kind=${kind}`);

        const firstCard = page.locator('.print-card').first();
        await expect(firstCard).toBeVisible();

        // The whole page never grows wider than the viewport — the bug
        // report's own `document.scrollWidth` measurement.
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

        // The first column is reachable, not shifted off the left edge by
        // being centred inside a box narrower than the sheet.
        const firstCardBox = await firstCard.boundingBox();
        expect(firstCardBox).not.toBeNull();
        expect(firstCardBox!.x).toBeGreaterThanOrEqual(0);

        // The sheet's own visual footprint fits the phone too, not just the
        // document as a whole.
        const sheetBox = await page.locator('.print-sheets').boundingBox();
        expect(sheetBox).not.toBeNull();
        expect(sheetBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);

        // It was actually the natural sheet that got shrunk here, not a
        // sheet that already fit — otherwise this test would pass by
        // accident on a document too narrow to trigger the bug.
        expect(naturalWidthPx(kind)).toBeGreaterThan(PHONE_VIEWPORT.width);
    });
}

test('at 1280px the sheet renders at its natural size, unscaled, unchanged from main (#1142)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Mobile Print Preview Desktop');
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/race/${raceId}/print`);

    const sheet = page.locator('.print-sheets');
    await expect(sheet).toBeVisible();

    // A container wider than the sheet applies no transform at all — the
    // exact DOM this page rendered before #1142, not merely a scale of 1
    // arrived at by coincidence.
    await expect(sheet).toHaveCSS('transform', 'none');

    // The span from the first card's left edge to the last card in its row's
    // right edge — not `.print-sheets`' own `boundingBox()`. That div's
    // *own* box legitimately reports a different number than it did on
    // main (it now shrinks to the sheet's natural size instead of filling
    // whatever the page happens to give it — see `PrintSheet.css`'s
    // `inline-grid` comment), but the cards inside it are pixel-identical:
    // centring moved from the grid's own `justify-content` to
    // `.print-sheet-scale-wrap`'s `text-align`, which puts an unscaled
    // sheet in exactly the same place either way. This is what
    // `screenshot-printables.spec.ts` confirms too, byte for byte.
    const spec = specFor('pit-pass');
    const firstCardBox = await page.locator('.print-card').first().boundingBox();
    const lastInRowBox = await page.locator('.print-card').nth(spec.columns - 1).boundingBox();
    expect(firstCardBox).not.toBeNull();
    expect(lastInRowBox).not.toBeNull();
    const cardSpanWidth = lastInRowBox!.x + lastInRowBox!.width - firstCardBox!.x;
    expect(cardSpanWidth).toBeCloseTo(naturalWidthPx('pit-pass'), 0);
});

test('print CSS resets the scale, so the printed sheet is always its natural size (#1142)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Mobile Print Preview Print CSS');
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto(`/race/${raceId}/print`);

    const sheet = page.locator('.print-sheets');
    await expect(sheet).toBeVisible();

    // Sanity: confirm the screen preview really is scaled down first, or a
    // pass below would prove nothing.
    const screenTransform = await sheet.evaluate((el) => getComputedStyle(el).transform);
    expect(screenTransform).not.toBe('none');
    const screenBox = await sheet.boundingBox();
    expect(screenBox!.width).toBeLessThan(naturalWidthPx('pit-pass'));

    await page.emulateMedia({ media: 'print' });

    await expect(sheet).toHaveCSS('transform', 'none');
    const printBox = await sheet.boundingBox();
    expect(printBox).not.toBeNull();
    expect(printBox!.width).toBeCloseTo(naturalPrintWidthPx('pit-pass'), 0);
});
