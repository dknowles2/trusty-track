/**
 * The check-in modal keeps weight, the inspection toggle and Save above the
 * fold on a phone and a tablet (#1153).
 *
 * `RacerForm.test.tsx` covers the reorder itself (field order, autofocus,
 * the disclosures' open/closed state) against a bare render with no `Modal`
 * around it and no real layout — jsdom has none. What only a real browser
 * shows is the thing the issue actually reported: with a real `Modal`, real
 * CSS and a real viewport, is Save actually reachable without scrolling?
 * `roster-desk.spec.ts` and `roster.spec.ts` already drive this same modal
 * for other reasons; this mirrors their seeding and locator style.
 */

import { test, expect, type Page } from '@playwright/test';
import { ensureConfigured, gql, seedRace } from './support';

/**
 * A racer reopened through "Checked In / Edit" often already carries both
 * photos — that's the whole reason the mockup shows a Photos section at
 * all — and each photo preview is its own 150px-tall image, one of the
 * biggest single contributors to how far down Save used to sit. Giving the
 * probed racer both (the URLs need not resolve; the `<img>` box is a fixed
 * inline `height: 150px` regardless of whether it loads) is what makes the
 * "old order" mutation check below fail with a realistic margin rather
 * than a narrow one.
 */
async function givePhotos(
    page: Page,
    racer: { id: number; firstName: string; lastName: string },
): Promise<void> {
    // `/static/<name>.<ext>` is the one shape `updateRacer` accepts
    // (`domain/photos.is_valid_photo_url`) — anything else is refused as an
    // external URL (#746). Neither file has to actually resolve: the
    // preview `<img>` carries a fixed inline `height: 150px` regardless of
    // whether it loads, which is the only thing this spec cares about.
    await gql(
        page,
        `mutation GivePhotosForCheckInSpec($id: Int!, $racer: RacerInput!) {
            updateRacer(id: $id, racer: $racer) { id }
        }`,
        {
            id: racer.id,
            racer: {
                firstName: racer.firstName,
                lastName: racer.lastName,
                racerImageUrl: '/static/mobile-checkin-spec-racer.jpg',
                carImageUrl: '/static/mobile-checkin-spec-car.jpg',
            },
        },
    );
}

/** Opens the first seeded racer's check-in/edit form from their roster row.
 * `RaceDetails.tsx` renders every racer twice — a `.racer-card` for the
 * mobile layout under 768px and a `.racer-row` `<tr>` for the desktop table
 * above it — with only one of the two actually visible at a given viewport
 * (CSS, not React). `:visible` picks out whichever one this viewport is
 * showing, so the same helper works across every width this file uses. */
async function openCheckInForm(page: Page, raceId: number, racerFirstName: string): Promise<void> {
    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');
    const container = page
        .locator('.racer-row:visible, .racer-card:visible')
        .filter({ hasText: racerFirstName });
    await container.getByRole('button', { name: /Check/ }).click();
}

const VIEWPORTS = [
    { width: 390, height: 844, label: '390×844 (phone)' },
    { width: 820, height: 1180, label: '820×1180 (tablet portrait)' },
];

for (const viewport of VIEWPORTS) {
    test(`${viewport.label}: weight is focused, and weight + Save both sit inside the first ${viewport.height}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const { raceId, racers } = await seedRace(
            page,
            `Mobile Check-In ${viewport.width}x${viewport.height} ` + Date.now(),
        );
        await ensureConfigured(page);
        const racer = racers[0];
        await givePhotos(page, racer);
        await openCheckInForm(page, raceId, racer.firstName);

        const dialog = page.getByRole('dialog', { name: 'Racer Check In' });
        await expect(dialog).toBeVisible();

        const weightInput = page.getByLabel('Car Weight (oz)');
        await expect(weightInput).toBeFocused();

        // Both boxes are read *before* anything is filled or clicked — a
        // `.fill()`/`.click()` scrolls its own target into view first, and
        // scrolling to reach the toggle would quietly bring Save into view
        // behind it, which is exactly the scrolling this assertion exists
        // to rule out. This is also the point at which the modal is
        // guaranteed to still be scrolled to its top: nothing has asked it
        // to move yet.
        const weightBox = await weightInput.boundingBox();
        expect(weightBox).not.toBeNull();
        expect(weightBox!.y).toBeGreaterThanOrEqual(0);
        expect(weightBox!.y + weightBox!.height).toBeLessThanOrEqual(viewport.height);

        const saveButton = page.getByRole('button', { name: 'Save Check-in' });
        const saveBox = await saveButton.boundingBox();
        expect(saveBox).not.toBeNull();
        expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(viewport.height);

        await weightInput.fill('4.75');

        const toggle = page.getByLabel('Passed Inspection / Checked In');
        // `seedRace` already checks every racer in, and re-opening keeps
        // that state (#848) — toggle it off and back on to exercise the
        // control at this size, ending on so Save actually checks them in.
        await expect(toggle).toBeChecked();
        await page.locator('label.toggle-switch:has(#car-passed-inspection)').click();
        await expect(toggle).not.toBeChecked();
        await expect(page.getByRole('button', { name: 'Save without checking in' })).toBeVisible();
        await page.locator('label.toggle-switch:has(#car-passed-inspection)').click();
        await expect(toggle).toBeChecked();

        await saveButton.click();
        await expect(dialog).toBeHidden();

        const result = await gql<{ racer: { carPassedInspection: boolean; carWeight: number | null } }>(
            page,
            `query CheckInSpecWeight($racerId: Int!) {
                racer(racerId: $racerId) { carPassedInspection carWeight }
            }`,
            { racerId: racer.id },
        );
        expect(result.racer.carPassedInspection).toBe(true);
        expect(result.racer.carWeight).toBeCloseTo(4.75, 2);
    });
}

test('at 1280×800, both Details and Photos are open by default', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { raceId, racers } = await seedRace(page, 'Mobile Check-In Desktop ' + Date.now());
    await ensureConfigured(page);
    await openCheckInForm(page, raceId, racers[0].firstName);

    const details = page.getByTestId('racer-form-details');
    const photos = page.getByTestId('racer-form-photos');
    expect(await details.getAttribute('open')).not.toBeNull();
    expect(await photos.getAttribute('open')).not.toBeNull();
    // Not merely marked open — the content inside is actually visible.
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByText('Racer Photo')).toBeVisible();
});
