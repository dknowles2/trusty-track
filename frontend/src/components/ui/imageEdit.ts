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
export function outputSize(crop: CropRect, maxEdge: number): ImageSize {
    const longest = Math.max(crop.width, crop.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    return {
        width: Math.round(crop.width * scale),
        height: Math.round(crop.height * scale),
    };
}
