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
import { attemptSuffix, ensureConfigured, gql } from './support';

/** A race with one racer whose racer photo is already "on file". */
async function seedRacerWithPhoto(page: Page, raceName: string): Promise<{ raceId: number }> {
    // A retry re-seeds against the same shared backend, and `races.name` is
    // unique — without a per-attempt suffix a retry after a flaky drag
    // assertion died on the constraint instead of getting a clean second
    // attempt (#1117), the same fix `attemptSuffix`'s own doc comment
    // describes for this suite's other specs. `--repeat-each` gets the
    // identical treatment: it collided on this constraint the same way
    // while verifying this very fix locally.
    raceName += attemptSuffix();

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
    // `index.css` declares both bundled faces `font-display: swap`
    // (`.claude/rules/documentation.md`'s "The font wait"); closing the swap
    // window before anything is measured rules it out as a source of reflow,
    // the same wait the docs screenshots use.
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: /Checked In/ }).click();

    const form = page.getByRole('dialog', { name: 'Racer Check In' });
    // #1153: the photo panels sit behind a **Photos** disclosure now, closed
    // by default under 768px — this spec's own 375px case included. Opening
    // it is a no-op above that breakpoint (already open), and checking
    // `open` first rather than clicking unconditionally avoids toggling an
    // already-open `<details>` back closed.
    const photosSection = form.getByTestId('racer-form-photos');
    const photosOpen = await photosSection.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!photosOpen) {
        await photosSection.locator('summary').click();
    }
    await form.getByRole('button', { name: /rotate \/ recrop/i }).click();

    const dialog = page.getByRole('dialog', { name: /rotate \/ recrop photo/i });
    await expect(dialog).toBeVisible();
    // `Modal.tsx`'s own entrance animation (`fadeIn 0.2s ease-out`)
    // translates the dialog — and the crop box inside it — down from
    // `translateY(20px)` to its resting position. That is exactly the
    // "top should not have moved" flake this spec hit in CI (received 20,
    // every time, at the wide viewport): under load, two `boundingBox()`
    // reads 50ms apart can land on the same still-mid-animation frame and
    // read as "settled" to `settledBoundingBox` before the animation's own
    // 200ms is actually up. Waiting the animation out here — the same
    // `getAnimations()`-based wait `settleTransitions` uses in the docs
    // harness — closes the gap at its source rather than teaching every
    // assertion below to tolerate a stray 20px that has nothing to do with
    // the drag being tested.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    return dialog;
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
    // A few intermediate steps, each given a moment to be handled on its
    // own: a single jump from A to B is not what a real drag looks like,
    // and is exactly the shape that would paper over a handler that only
    // reacts to the first `pointermove`. Under CI load, though, `pointermove`
    // events can coalesce — several of the six small steps this used to take
    // arriving as one — and the modal's scale derivation can land between
    // two of them, which is how a real fix (#1113) still measured a short
    // drag under load (#1117). Fewer, larger steps with a short pause
    // between reduce how much of the requested movement a single coalesced
    // event can absorb.
    const steps = 3;
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(fromX + (dx * i) / steps, fromY + (dy * i) / steps);
        await page.waitForTimeout(30);
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

            // The recrop path edits a photo already on file, so its footer
            // carries #1242's own vocabulary rather than the camera capture
            // path's "Cancel" / "Use this photo".
            await expect(modal.getByRole('button', { name: 'Keep original' })).toBeVisible();
            await expect(modal.getByRole('button', { name: 'Save changes' })).toBeVisible();

            // The square racer crop against this landscape photo fills the
            // stage's full height (`fitInitialCrop` maximizes it) and has
            // slack only on the sides — enough to prove a rightward drag
            // moves the box by the requested amount, in real screen pixels,
            // at whatever width the stage actually rendered.
            const before = await settledBoundingBox(box);
            const startX = before.x + before.width / 2;
            const startY = before.y + before.height / 2;

            await dragBy(page, startX, startY, 60, 0);

            // Settled, not the first read after `mouseup` (#1117): a
            // coalesced `pointermove` can still be in flight the instant
            // the drag ends, and reading immediately caught the box a step
            // or two short of where it was going to land.
            const after = await settledBoundingBox(box);
            // Pre-fix `main` moved the box only ~10px of the 60 requested
            // (#1113's bug), so 40px is well clear of that failure while
            // still tolerating a coalesced step or two under load — tight
            // enough to catch the regression, loose enough to survive it.
            expect(after.x - before.x, 'left should have moved right by roughly 60px').toBeGreaterThanOrEqual(
                40,
            );
            expect(after.x - before.x, 'left should not have overshot the requested 60px').toBeLessThanOrEqual(
                75,
            );
            expect(
                Math.abs(after.y - before.y),
                'top should not have moved — there is no vertical slack yet',
            ).toBeLessThanOrEqual(2);
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

            // Settled, for the same reason as the move test above — a
            // coalesced `pointermove` can still be catching up the instant
            // `mouseup` fires.
            const after = await settledBoundingBox(box);
            // Loosened from the original 30px margin the same way as the
            // move test's threshold (#1117): a handler that never resized
            // at all leaves `after.width` equal to `before.width`, which
            // this still catches with plenty of room to spare.
            expect(after.width, 'dragging the SE handle inward should shrink the box').toBeLessThan(
                before.width - 15,
            );
            expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
            // The opposite (nw) corner is the resize's anchor and must not
            // have moved.
            expect(after.x).toBe(before.x);
            expect(after.y).toBe(before.y);
        });

        test('rotating carries the crop with the photo instead of resetting it (#1240)', async ({ page }) => {
            const { raceId } = await seedRacerWithPhoto(page, `Crop Rotate ${viewport.width}`);
            const modal = await openCropModal(page, raceId);
            const box = modal.getByRole('group', { name: /crop area/i });
            const stage = modal.getByTestId('image-crop-stage');
            await expect(box).toBeVisible();

            // The square racer crop against this 900x600 photo already
            // fills the stage's full height (`fitInitialCrop` maximizes it,
            // same reasoning as the move test above) — the only room to
            // drag is horizontal, so "a corner" here is the left or right
            // edge, flush top to bottom, rather than a single point.
            const beforeDrag = await settledBoundingBox(box);
            const startX = beforeDrag.x + beforeDrag.width / 2;
            const startY = beforeDrag.y + beforeDrag.height / 2;
            // The natural 300px of horizontal room is exactly half the
            // natural 600px crop width — dragging by more than half the
            // box's own (scaled) width overshoots the available slack in
            // either viewport, and `clampCrop` pins the box at the wall
            // rather than letting it run off the stage.
            await dragBy(page, startX, startY, -beforeDrag.width * 0.6, 0);

            const leftFlush = await settledBoundingBox(box);
            const stageAfterDrag = await stage.boundingBox();
            if (!stageAfterDrag) throw new Error('stage has no layout');
            expect(
                leftFlush.x - stageAfterDrag.x,
                'dragged fully left should sit flush against the left edge',
            ).toBeLessThanOrEqual(5);

            await modal.getByRole('button', { name: /rotate right/i }).click();

            // Position is read relative to the stage, not the viewport:
            // rotating swaps the stage's own displayed width and height
            // (900x600 becomes 600x900), and `Modal.tsx` centres its
            // content in the viewport, so the stage itself moves on screen
            // even though nothing about the crop selection has.
            const afterRight = await settledBoundingBox(box);
            const stageAfterRight = await stage.boundingBox();
            if (!stageAfterRight) throw new Error('stage has no layout');
            // A clockwise turn maps "flush left" to "flush top" — see
            // `rotateCrop`'s own doc comment in `imageEdit.ts` for the
            // centre-mapping formula, so a correct rotate leaves this offset
            // at (near) zero, the same "flush against the edge" shape the
            // drag assertion above and the rotate-back assertion below both
            // check with an absolute 5px bound. The mutation this guards
            // against (`fitInitialCrop` on rotate, #1240) would centre the
            // box instead — at roughly *half* the stage's own remaining
            // slack (`stageAfterRight.height - afterRight.height`), tens of
            // pixels here — so a 5px bound still catches it with room to
            // spare; the old `slackAfterRight * 0.4` bound (62–84px in this
            // stage) was 15–20x looser than the ideal offset of ~0 needed to
            // be.
            const offsetAfterRight = afterRight.y - stageAfterRight.y;
            expect(
                offsetAfterRight,
                'rotating right should carry the drag flush to the top edge, not reset to centred',
            ).toBeLessThanOrEqual(5);

            // Rotate back: the crop should return to the left edge it was
            // dragged to, not the (now landscape-again) default centre.
            await modal.getByRole('button', { name: /rotate left/i }).click();
            const afterLeft = await settledBoundingBox(box);
            const stageAfterLeft = await stage.boundingBox();
            if (!stageAfterLeft) throw new Error('stage has no layout');
            expect(
                afterLeft.x - stageAfterLeft.x,
                'rotating back left should return the crop to the left edge',
            ).toBeLessThanOrEqual(5);
        });

        test('a saved crop is non-destructive: reopening shows the original, pre-cropped at the same place, and a loosened crop persists too (#1241)', async ({ page }) => {
            const { raceId } = await seedRacerWithPhoto(page, `Crop Loosen ${viewport.width}`);
            const form = page.getByRole('dialog', { name: 'Racer Check In' });
            const preview = form.getByAltText('Racer');

            const modal = await openCropModal(page, raceId);
            const box = modal.getByRole('group', { name: /crop area/i });
            const stage = modal.getByTestId('image-crop-stage');
            await expect(box).toBeVisible();

            // Crop tightly: drag the SE handle a long way in toward the
            // fixed (nw) corner, the same technique the resize test above
            // uses.
            const beforeTighten = await settledBoundingBox(box);
            let seHandle = box.locator('> div').nth(3);
            let handleBox = await seHandle.boundingBox();
            if (!handleBox) throw new Error('se handle has no layout');
            await dragBy(page, handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, -120, -120);

            const tight = await settledBoundingBox(box);
            expect(tight.width, 'the SE drag should have shrunk the box well below its start').toBeLessThan(
                beforeTighten.width - 40,
            );
            const stageAtTighten = await stage.boundingBox();
            if (!stageAtTighten) throw new Error('stage has no layout');
            // Recorded relative to the stage, not the viewport — `Modal.tsx`
            // centres its content, so the stage itself can sit at a
            // different screen position once it reopens (the box's own
            // bounding box does not have to be at the identical viewport
            // coordinates, only the identical position *within the photo*).
            const tightRelative = {
                x: tight.x - stageAtTighten.x,
                y: tight.y - stageAtTighten.y,
                width: tight.width,
                height: tight.height,
            };

            const originalPreviewSrc = await preview.getAttribute('src');
            await modal.getByRole('button', { name: 'Save changes' }).click();
            await expect(modal).not.toBeVisible();
            // The recrop upload is asynchronous (`recropUpload` in
            // `RacerForm.tsx`) — the roster preview's own `src` is what
            // confirms it has landed, the same signal
            // `RacerFormRotate.test.tsx` waits on at the unit level.
            await expect(preview).not.toHaveAttribute('src', originalPreviewSrc ?? '');

            // Reopen — same button, same still-open Check In form, no
            // navigation in between.
            await form.getByRole('button', { name: /rotate \/ recrop/i }).click();
            const reopened = page.getByRole('dialog', { name: /rotate \/ recrop photo/i });
            await expect(reopened).toBeVisible();
            await reopened.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

            // The stage shows the *original* 900x600 photo, not the tightly
            // cropped derived image — a browser decodes the real file here,
            // so its natural size is the actual evidence, not a claim about
            // which URL loaded.
            const stagePhoto = reopened.locator('img[alt="Photo being cropped"]');
            await expect(stagePhoto).toBeVisible();
            const naturalSize = await stagePhoto.evaluate((img: HTMLImageElement) => [
                img.naturalWidth,
                img.naturalHeight,
            ]);
            expect(naturalSize, 'the stage should be showing the original, not the cropped result').toEqual([
                900, 600,
            ]);

            const reopenedBox = reopened.getByRole('group', { name: /crop area/i });
            const reopenedStage = reopened.getByTestId('image-crop-stage');
            await expect(reopenedBox).toBeVisible();
            const preApplied = await settledBoundingBox(reopenedBox);
            const reopenedStageBox = await reopenedStage.boundingBox();
            if (!reopenedStageBox) throw new Error('stage has no layout');
            const preAppliedRelative = {
                x: preApplied.x - reopenedStageBox.x,
                y: preApplied.y - reopenedStageBox.y,
                width: preApplied.width,
                height: preApplied.height,
            };
            expect(
                Math.abs(preAppliedRelative.x - tightRelative.x),
                'the crop box should reopen at the same left offset it was left at',
            ).toBeLessThanOrEqual(5);
            expect(
                Math.abs(preAppliedRelative.y - tightRelative.y),
                'the crop box should reopen at the same top offset it was left at',
            ).toBeLessThanOrEqual(5);
            expect(
                Math.abs(preAppliedRelative.width - tightRelative.width),
                'the crop box should reopen at the same width it was left at',
            ).toBeLessThanOrEqual(5);

            // Now loosen it — drag the SE handle back out, recovering some
            // of what the tight crop above cut off. This is the whole
            // point: a crop that was too tight the first time can be
            // undone, which was impossible before #1241 (the modal used to
            // reopen on the already-cropped result, with nothing outside
            // its edges left to drag back into view).
            seHandle = reopenedBox.locator('> div').nth(3);
            handleBox = await seHandle.boundingBox();
            if (!handleBox) throw new Error('se handle has no layout');
            await dragBy(page, handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, 150, 150);
            const loosened = await settledBoundingBox(reopenedBox);
            expect(loosened.width, 'dragging the SE handle out should grow the box past the tight crop').toBeGreaterThan(
                preAppliedRelative.width + 40,
            );

            const previewSrcBeforeSecondSave = await preview.getAttribute('src');
            await reopened.getByRole('button', { name: 'Save changes' }).click();
            await expect(reopened).not.toBeVisible();
            await expect(preview).not.toHaveAttribute('src', previewSrcBeforeSecondSave ?? '');

            // Reopen a third time — the loosened size is what comes back,
            // not the tight one from the first save.
            await form.getByRole('button', { name: /rotate \/ recrop/i }).click();
            const reopenedAgain = page.getByRole('dialog', { name: /rotate \/ recrop photo/i });
            await expect(reopenedAgain).toBeVisible();
            await reopenedAgain.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

            const finalBox = reopenedAgain.getByRole('group', { name: /crop area/i });
            await expect(finalBox).toBeVisible();
            const finalCrop = await settledBoundingBox(finalBox);
            expect(
                finalCrop.width,
                'the loosened crop should be what reopens, not the original tight one',
            ).toBeGreaterThan(tight.width + 30);
        });
    });
}
