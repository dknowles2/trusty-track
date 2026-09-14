/**
 * Form inputs are `box-sizing: content-box` by default, so an inline
 * `width: 100%` plus this codebase's own padding renders wider than its
 * container (#1150). Two consequences, both measured against real
 * bounding boxes rather than trusting the CSS that produced them:
 *
 * - `RacerForm.tsx`'s two-column grids overlap at 390px — the reported
 *   measurement had "Last Name" starting 8px inside "First Name"'s own box,
 *   and every right-column input running 18px past the modal's padding.
 * - System Settings' Organization Name input runs past the page's own
 *   right edge on the same viewport.
 *
 * `mobileNav.spec.ts` already owns the nav-overflow shape this borrows
 * (viewport-driven, `document.documentElement.scrollWidth` as the
 * page-level check); this is a sibling file rather than an addition there
 * because the bug is in the form layer, not the navigation.
 */

import { expect, test, type Page } from '@playwright/test';

import { ensureConfigured, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function rectsOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The dialog's own content box — inside its padding, the region the
 * issue's measurements were taken against. */
async function dialogContentBox(page: Page): Promise<{ left: number; right: number }> {
    return page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        const rect = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return {
            left: rect.left + parseFloat(style.paddingLeft),
            right: rect.right - parseFloat(style.paddingRight),
        };
    });
}

test('the Add Racer form has no overlapping fields and stays inside the dialog on a 390px phone (#1150)', async ({
    page,
}) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    const { raceId } = await seedRace(page, 'Form Box Sizing Add Racer ' + Date.now());
    await ensureConfigured(page);

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Add Racer$/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Add New Racer' });
    await expect(dialog).toBeVisible();
    // The dialog fades and slides in (`Modal.tsx`'s own `fadeIn` keyframe) —
    // measuring mid-animation would catch a transient `translateY` offset
    // rather than the settled layout this is actually about.
    await dialog.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((a) => a.finished));
    });

    const fieldIds = [
        'racer-first-name',
        'racer-last-name',
        'racer-car-number',
        'racer-car-weight',
        'racer-car-name',
    ];
    const boxes: Record<string, Box> = {};
    for (const id of fieldIds) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box, `#${id} has no bounding box`).not.toBeNull();
        boxes[id] = box!;
    }

    // No two of the form's own inputs overlap — the check-in desk's report
    // was "Last Name starts 8px inside First Name's own box".
    for (let i = 0; i < fieldIds.length; i++) {
        for (let j = i + 1; j < fieldIds.length; j++) {
            expect(
                rectsOverlap(boxes[fieldIds[i]], boxes[fieldIds[j]]),
                `#${fieldIds[i]} and #${fieldIds[j]} overlap`,
            ).toBe(false);
        }
    }

    // Every field's right edge sits inside the dialog's own content box —
    // the reported overrun was the right-column inputs running 18px past
    // the modal's padding.
    const content = await dialogContentBox(page);
    for (const id of fieldIds) {
        expect(boxes[id].x + boxes[id].width, `#${id} overruns the dialog`).toBeLessThanOrEqual(content.right + 0.5);
    }
});

test('the Organization Name input stays inside the page on a 390px phone (#1150)', async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await ensureConfigured(page);

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Organization Name')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(PHONE_VIEWPORT.width);
});
