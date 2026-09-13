/**
 * The photo crop modal, end to end (#1094).
 *
 * `ImageCropModal.test.tsx` only fires `load`/`click` on a jsdom document,
 * which has no layout at all — a pointer drag needs real coordinates, real
 * `getBoundingClientRect()`, and a real `scale` derived from how wide the
 * container actually rendered, none of which jsdom can give it. This is the
 * one place that can catch a broken drag.
 *
 * `RacerForm`'s "Rotate / Recrop" control reopens `ImageCropModal` against
 * an already-uploaded photo, which is the easiest door into it from outside
 * — no `CameraCapture`/getUserMedia stubbing needed. The photo itself is
 * drawn on an in-page `<canvas>` and pushed through `uploadImage`, so the
 * modal loads a real image from `/static/...` exactly as it would in
 * production, rather than a fixture file this repo would otherwise have to
 * carry.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { ensureConfigured, gql } from './support';

/** A race with one racer whose racer photo is already "on file". */
async function seedRacerWithPhoto(page: Page, raceName: string): Promise<{ raceId: number }> {
    await ensureConfigured(page);

    const config = await gql<{ organizations: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { organizations { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: raceName,
                organizationId: config.organizations[0].id,
                trackId: config.tracks[0].id,
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    const racer = await gql<{ createRacer: { id: number } }>(
        page,
        `mutation Racer($racer: RacerInput!) { createRacer(racer: $racer) { id } }`,
        { racer: { raceId, firstName: 'Photo', lastName: 'Case', carNumber: 1 } },
    );
    const racerId = racer.createRacer.id;

    // A real 900x600 photo, drawn in the browser rather than checked in as a
    // fixture file — `uploadImage` takes the same data URL shape either way.
    const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 600;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = '#3366cc';
        ctx.fillRect(0, 0, 900, 600);
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(350, 200, 200, 200);
        return canvas.toDataURL('image/png');
    });
    const uploaded = await gql<{ uploadImage: string }>(
        page,
        `mutation Upload($dataUrl: String!) { uploadImage(dataUrl: $dataUrl) }`,
        { dataUrl },
    );

    await gql(
        page,
        `mutation CheckIn($id: Int!, $url: String) {
            checkInRacer(id: $id, passedInspection: true, weight: null, racerImageUrl: $url) { id }
        }`,
        { id: racerId, url: uploaded.uploadImage },
    );

    return { raceId };
}

/** Open the racer's edit form and then the racer photo's crop modal.
 *
 * Not scoped to a table row: below the roster's mobile breakpoint the same
 * data renders as a card rather than a `<table>` row, and each race here
 * seeds exactly one racer, so the button's own accessible name is enough to
 * find it either way.
 */
async function openCropModal(page: Page, raceId: number): Promise<Locator> {
    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /Checked In/ }).click();

    const form = page.getByRole('dialog', { name: 'Racer Check In' });
    await form.getByRole('button', { name: /rotate \/ recrop/i }).click();

    return page.getByRole('dialog', { name: /rotate \/ recrop photo/i });
}

/**
 * The crop box's layout the instant it appears is mid-transition: the stage
 * renders at a placeholder height until the photo's `onLoad` fires, and the
 * height (and everything below it in the modal) settles to its real value a
 * render or two later — a plain layout consequence of the image finishing
 * its load, nothing to do with the pointer bug this file tests, but real
 * enough that a bounding box read the instant the group becomes visible can
 * still be mid-shift. Polling for two identical reads in a row is cheaper
 * than teaching the component to announce "done settling", and this is a
 * test concern rather than something a real operator — who starts dragging
 * only once they see a picture that has stopped moving — ever notices.
 */
async function settledBoundingBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    let previous = await locator.boundingBox();
    for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const current = await locator.boundingBox();
        if (
            previous &&
            current &&
            previous.x === current.x &&
            previous.y === current.y &&
            previous.width === current.width &&
            previous.height === current.height
        ) {
            return current;
        }
        previous = current;
    }
    throw new Error('crop box layout never settled');
}

async function dragBy(page: Page, fromX: number, fromY: number, dx: number, dy: number): Promise<void> {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    // Several intermediate steps: a single jump from A to B is not what a
    // real drag looks like, and is exactly the shape that would paper over a
    // handler that only reacts to the first `pointermove`.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(fromX + (dx * i) / steps, fromY + (dy * i) / steps);
    }
    await page.mouse.up();
}

for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 800 },
]) {
    test.describe(`at ${viewport.width}px wide`, () => {
        test.use({ viewport });

        test('dragging the crop box moves it', async ({ page }) => {
            const { raceId } = await seedRacerWithPhoto(page, `Crop Move ${viewport.width}`);
            const modal = await openCropModal(page, raceId);
            const box = modal.getByRole('group', { name: /crop area/i });
            await expect(box).toBeVisible();

            // The square racer crop against this landscape photo fills the
            // stage's full height (`fitInitialCrop` maximizes it) and has
            // slack only on the sides — enough to prove a rightward drag
            // moves the box by the requested amount, in real screen pixels,
            // at whatever width the stage actually rendered.
            const before = await settledBoundingBox(box);
            const startX = before.x + before.width / 2;
            const startY = before.y + before.height / 2;

            await dragBy(page, startX, startY, 60, 0);

            const after = await box.boundingBox();
            if (!after) throw new Error('crop box has no layout after move');
            expect(after.x - before.x, 'left should have moved right by ~60px').toBeGreaterThan(45);
            expect(after.x - before.x, 'left should not have overshot the requested 60px').toBeLessThan(
                75,
            );
            expect(after.y, 'top should not have moved — there is no vertical slack yet').toBe(before.y);
        });

        test('dragging a corner handle resizes the box, preserving aspect', async ({ page }) => {
            const { raceId } = await seedRacerWithPhoto(page, `Crop Resize ${viewport.width}`);
            const modal = await openCropModal(page, raceId);
            const box = modal.getByRole('group', { name: /crop area/i });
            await expect(box).toBeVisible();

            const before = await settledBoundingBox(box);

            // The SE handle is the last of the four corner dots rendered
            // inside the crop box (nw, ne, sw, se, in that order).
            const seHandle = box.locator('> div').nth(3);
            const handleBox = await seHandle.boundingBox();
            if (!handleBox) throw new Error('se handle has no layout');
            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;

            // Inward, toward the fixed (nw) corner — the box only has room
            // to shrink from its maximized starting size, not grow.
            await dragBy(page, startX, startY, -50, -50);

            const after = await box.boundingBox();
            if (!after) throw new Error('crop box has no layout after resize');
            expect(after.width, 'dragging the SE handle inward should shrink the box').toBeLessThan(
                before.width - 30,
            );
            expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
            // The opposite (nw) corner is the resize's anchor and must not
            // have moved.
            expect(after.x).toBe(before.x);
            expect(after.y).toBe(before.y);
        });
    });
}
