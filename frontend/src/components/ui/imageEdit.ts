/**
 * The geometry rules behind {@link ../ImageCropModal.tsx | ImageCropModal} —
 * rotation, cropping and output sizing, over plain numbers. No canvas, no
 * DOM, no React: the modal owns the pointer handling and the canvas draw,
 * this owns the arithmetic, so the arithmetic is testable without a browser
 * and the modal has nothing left to get wrong about it (issue #619).
 */

/** A size in pixels — an image's natural dimensions, or an output's. */
export interface ImageSize {
    width: number;
    height: number;
}

/** A crop rectangle, in the natural pixel space it was measured against. */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One of the four axis-aligned rotations a photo can be turned to. */
export type Quarter = 0 | 90 | 180 | 270;

export type RotationDirection = 'left' | 'right';

/**
 * What a crop *is* — a rotation plus the crop rectangle it was applied
 * with, in the rotated image's own pixel space (#1241). This is exactly the
 * state {@link ../ImageCropModal.tsx | ImageCropModal} already holds in
 * `rotation`/`crop`, so it needs no conversion on the way in (seeding the
 * modal from a stored edit) or out (`onConfirm` reporting one): "set
 * rotation, then set crop" reproduces the modal's own state exactly.
 *
 * Stored server-side as JSON the server never interprets
 * (`Racer.racerImageEdit`/`carImageEdit`) — {@link serializeImageEdit} and
 * {@link parseImageEdit} are the only two functions that read or write that
 * shape, so there is one place to change it.
 */
export interface ImageEdit {
    rotation: Quarter;
    crop: CropRect;
}

function isQuarter(value: unknown): value is Quarter {
    return value === 0 || value === 90 || value === 180 || value === 270;
}

function isCropRect(value: unknown): value is CropRect {
    if (typeof value !== 'object' || value === null) return false;
    const rect = value as Record<string, unknown>;
    return (
        typeof rect.x === 'number' &&
        typeof rect.y === 'number' &&
        typeof rect.width === 'number' &&
        typeof rect.height === 'number'
    );
}

/**
 * Read a stored `racerImageEdit`/`carImageEdit` value back into an
 * {@link ImageEdit} — tolerant of everything that is not one, since a
 * malformed or unrecognised value must never stop the crop modal from
 * opening. `null`/`undefined` (nothing on file yet, or a racer that
 * predates #1241), a parse failure, and a value that parses but is not
 * shaped like an `ImageEdit` all answer `null` alike; nothing here throws.
 */
export function parseImageEdit(json: string | null | undefined): ImageEdit | null {
    if (!json) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!isQuarter(candidate.rotation) || !isCropRect(candidate.crop)) return null;
    return { rotation: candidate.rotation, crop: candidate.crop };
}

/** The inverse of {@link parseImageEdit} — a plain `JSON.stringify`, kept
 * as its own function so nothing else in the tree hand-rolls the shape. */
export function serializeImageEdit(edit: ImageEdit): string {
    return JSON.stringify(edit);
}

/** Square — fits every avatar and the pit pass's circular portrait. */
export const PORTRAIT_ASPECT = 1;

/** Landscape — a car photographed from the side. */
export const CAR_ASPECT = 4 / 3;

/**
 * Neither edge of a crop may fall below this, in natural pixels. Small
 * enough to never bind on an ordinary photo, large enough that a crop box
 * dragged to nothing does not vanish under the operator's finger.
 */
export const MIN_CROP_SIZE = 40;

/**
 * Turn one quarter-turn, in either direction. Four calls in the same
 * direction is the identity — nothing about the photo has changed, only
 * that it has been asked about four times.
 */
export function rotateQuarter(rotation: Quarter, direction: RotationDirection): Quarter {
    const delta = direction === 'right' ? 90 : -90;
    return (((rotation + delta) % 360) + 360) % 360 as Quarter;
}

/**
 * The size a photo displays at once `rotation` is applied — width and
 * height trade places on a quarter turn, unchanged on a half turn.
 */
export function rotatedSize(size: ImageSize, rotation: Quarter): ImageSize {
    return rotation === 90 || rotation === 270
        ? { width: size.height, height: size.width }
        : { width: size.width, height: size.height };
}

/**
 * Turn a crop rectangle through the same quarter-turn the photo is about to
 * take, so rotating the photo keeps the operator's own selection instead of
 * discarding it back to {@link fitInitialCrop}'s default.
 *
 * The rectangle itself is not rotated in place — a `width`x`height` box
 * turned 90° becomes a `height`x`width` one, which the aspect lock
 * (`PORTRAIT_ASPECT`, `CAR_ASPECT`) forbids for anything but a square crop.
 * What is carried across the turn instead is the rectangle's **centre**
 * and its **size**: the centre maps to wherever that point lands in the
 * newly rotated image (`imageSize.width × imageSize.height`, clockwise,
 * becomes `imageSize.height × imageSize.width`), the size is kept exactly
 * as it was, and {@link clampCrop} — already documented as centre-preserving
 * and safe to call after any move — pulls the rebuilt rectangle back to one
 * locked to `aspect` inside the rotated bounds.
 *
 * That is why a square crop (`PORTRAIT_ASPECT`) survives a turn exactly:
 * `clampCrop` has nothing left to correct once the centre has moved, so the
 * same natural pixels stay selected. A 4:3 crop (`CAR_ASPECT`) cannot be
 * exact — no aspect-locked rectangle rotated a quarter turn stays the same
 * shape — but it comes back centred on the same point at the same size,
 * which is the closest the lock allows and is a world away from resetting
 * to the default. A half turn (two calls in opposite directions, or four in
 * the same one) is exact for both, since neither the centre nor the size
 * changes shape on a turn that doesn't swap width and height.
 *
 * `imageSize` is the size the crop is *currently* expressed in — the
 * rotated display size (`rotatedSize`'s own output), not the original,
 * unrotated photo — because `crop`'s coordinates are already in that space.
 */
export function rotateCrop(
    crop: CropRect,
    imageSize: ImageSize,
    direction: RotationDirection,
    aspect: number,
): CropRect {
    const { width: w, height: h } = imageSize;
    const cx = crop.x + crop.width / 2;
    const cy = crop.y + crop.height / 2;

    const [newCx, newCy] = direction === 'right' ? [h - cy, cx] : [cy, w - cx];

    const rect: CropRect = {
        x: newCx - crop.width / 2,
        y: newCy - crop.height / 2,
        width: crop.width,
        height: crop.height,
    };
    // Either direction swaps width and height — `rotatedSize` only cares
    // whether the turn is a quarter or a half, not which quarter.
    return clampCrop(rect, rotatedSize(imageSize, 90), aspect);
}

/**
 * Pull a crop rectangle back to a valid one: locked to `aspect` (derived off
 * the requested width), no smaller than {@link MIN_CROP_SIZE} on either edge
 * unless the image itself is smaller, and never outside `imageSize`. The
 * rectangle's centre is preserved as closely as the image's edges allow,
 * which is what makes this safe to call after a move as well as a resize —
 * a move only ever changes `x`/`y`, and `width` survives here unchanged
 * whenever it already fit.
 */
export function clampCrop(crop: CropRect, imageSize: ImageSize, aspect: number): CropRect {
    const { width: imgW, height: imgH } = imageSize;

    // Locked to `aspect`: neither edge may go below MIN_CROP_SIZE, so the
    // floor on width is whichever of the two the aspect ratio makes larger.
    const minWidth = MIN_CROP_SIZE * Math.max(1, aspect);
    // Never bigger than the image itself, in either dimension.
    const maxWidth = Math.min(imgW, imgH * aspect);
    const effectiveMin = Math.min(minWidth, maxWidth);

    const width = Math.min(Math.max(crop.width, effectiveMin), maxWidth);
    const height = width / aspect;

    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    const x = Math.min(Math.max(centerX - width / 2, 0), imgW - width);
    const y = Math.min(Math.max(centerY - height / 2, 0), imgH - height);

    return { x, y, width, height };
}

/** The largest crop of `aspect` that fits inside `imageSize`, centred. */
export function fitInitialCrop(imageSize: ImageSize, aspect: number): CropRect {
    return clampCrop(
        { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
        imageSize,
        aspect,
    );
}

/**
 * The pixel size to render a crop at, downscaled so its longer edge is at
 * most `maxEdge` — these upload as data URLs over venue wifi, so a
 * full-resolution photo crossing the network uncompressed is the thing this
 * exists to prevent. Never upscales: a crop already smaller than `maxEdge`
 * comes back unchanged (rounded to whole pixels).
 */
/**
 * The scale factor between an image's natural pixels and the crop stage's
 * on-screen pixels.
 *
 * The stage's container carries both an explicit intended width and
 * `maxWidth: '100%'`, so inside a narrow modal (a phone, or any viewport
 * narrower than the modal's own max width) the container renders smaller
 * than the intended size while a scale derived from that constant does not
 * shrink with it. Every conversion between on-screen and natural pixels —
 * where a pointer landed, where the crop box should be drawn — is wrong by
 * that ratio once that happens, which is what made a drag in
 * `ImageCropModal` pull the crop straight back where it started (#1094):
 * `clampCrop` was being asked to place a box using a natural-pixel position
 * computed with the wrong scale.
 *
 * `measuredWidth` is the container's actual rendered width, read off its
 * `getBoundingClientRect()` (or a `ResizeObserver`) once it exists. Before
 * that first measurement — the very first paint — this falls back to the
 * same constant-over-longest-edge formula the container's own unmeasured
 * inline width is computed with, so the two agree until a real measurement
 * is available to correct them together.
 */
export function deriveScale(
    rotated: ImageSize | null,
    measuredWidth: number | null,
    intendedMaxEdge: number,
): number {
    if (!rotated) return 1;
    if (measuredWidth && measuredWidth > 0) return measuredWidth / rotated.width;
    return intendedMaxEdge / Math.max(rotated.width, rotated.height);
}

export function outputSize(crop: CropRect, maxEdge: number): ImageSize {
    const longest = Math.max(crop.width, crop.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    return {
        width: Math.round(crop.width * scale),
        height: Math.round(crop.height * scale),
    };
}
