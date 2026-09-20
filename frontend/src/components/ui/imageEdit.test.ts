import { describe, it, expect } from 'vitest';
import {
    rotateCrop,
    rotateQuarter,
    rotatedSize,
    clampCrop,
    deriveScale,
    fitInitialCrop,
    outputSize,
    parseImageEdit,
    serializeImageEdit,
    PORTRAIT_ASPECT,
    CAR_ASPECT,
    MIN_CROP_SIZE,
    type CropRect,
    type ImageEdit,
    type Quarter,
} from './imageEdit';

describe('rotateQuarter', () => {
    it('composes to identity after four turns in the same direction', () => {
        let rotation: Quarter = 0;
        for (let i = 0; i < 4; i++) rotation = rotateQuarter(rotation, 'right');
        expect(rotation).toBe(0);

        rotation = 90;
        for (let i = 0; i < 4; i++) rotation = rotateQuarter(rotation, 'left');
        expect(rotation).toBe(90);
    });

    it('steps through the four quarters in order', () => {
        expect(rotateQuarter(0, 'right')).toBe(90);
        expect(rotateQuarter(90, 'right')).toBe(180);
        expect(rotateQuarter(180, 'right')).toBe(270);
        expect(rotateQuarter(270, 'right')).toBe(0);
    });

    it('left is the inverse of right', () => {
        const start: Quarter = 90;
        expect(rotateQuarter(rotateQuarter(start, 'right'), 'left')).toBe(start);
        expect(rotateQuarter(rotateQuarter(start, 'left'), 'right')).toBe(start);
    });
});

describe('rotatedSize', () => {
    const size = { width: 800, height: 600 };

    it('swaps the edges on a quarter turn', () => {
        expect(rotatedSize(size, 90)).toEqual({ width: 600, height: 800 });
        expect(rotatedSize(size, 270)).toEqual({ width: 600, height: 800 });
    });

    it('leaves the edges alone on a half turn or none', () => {
        expect(rotatedSize(size, 0)).toEqual({ width: 800, height: 600 });
        expect(rotatedSize(size, 180)).toEqual({ width: 800, height: 600 });
    });
});

describe('rotateCrop', () => {
    it('is the identity after four turns in the same direction', () => {
        const original: CropRect = { x: 120, y: 80, width: 200, height: 200 };
        let size = { width: 800, height: 600 };
        let crop = original;
        for (let i = 0; i < 4; i++) {
            crop = rotateCrop(crop, size, 'right', PORTRAIT_ASPECT);
            size = rotatedSize(size, 90);
        }
        expect(crop.x).toBeCloseTo(original.x, 5);
        expect(crop.y).toBeCloseTo(original.y, 5);
        expect(crop.width).toBeCloseTo(original.width, 5);
        expect(crop.height).toBeCloseTo(original.height, 5);
    });

    it('is the identity after a right turn undone by a left turn', () => {
        const imageSize = { width: 800, height: 600 };
        const original: CropRect = { x: 120, y: 80, width: 200, height: 200 };
        const afterRight = rotateCrop(original, imageSize, 'right', PORTRAIT_ASPECT);
        const afterLeft = rotateCrop(afterRight, rotatedSize(imageSize, 90), 'left', PORTRAIT_ASPECT);
        expect(afterLeft.x).toBeCloseTo(original.x, 5);
        expect(afterLeft.y).toBeCloseTo(original.y, 5);
        expect(afterLeft.width).toBeCloseTo(original.width, 5);
        expect(afterLeft.height).toBeCloseTo(original.height, 5);
    });

    it('carries a square crop from the top-left corner to the top-right on a clockwise turn', () => {
        const imageSize = { width: 800, height: 600 };
        const topLeft: CropRect = { x: 0, y: 0, width: 100, height: 100 };
        const result = rotateCrop(topLeft, imageSize, 'right', PORTRAIT_ASPECT);
        // Rotated bounds are 600x800 — top-right means x pinned to the far
        // edge, y still at 0.
        expect(result.x).toBeCloseTo(500, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.width).toBeCloseTo(100, 5);
        expect(result.height).toBeCloseTo(100, 5);
    });

    it('carries a square crop from the bottom-left corner to the top-left on a clockwise turn', () => {
        const imageSize = { width: 800, height: 600 };
        const bottomLeft: CropRect = { x: 0, y: 500, width: 100, height: 100 };
        const result = rotateCrop(bottomLeft, imageSize, 'right', PORTRAIT_ASPECT);
        expect(result.x).toBeCloseTo(0, 5);
        expect(result.y).toBeCloseTo(0, 5);
        expect(result.width).toBeCloseTo(100, 5);
        expect(result.height).toBeCloseTo(100, 5);
    });

    it('keeps a 4:3 crop the same size and maps its centre through the turn', () => {
        const imageSize = { width: 800, height: 600 };
        const crop: CropRect = { x: 50, y: 50, width: 200, height: 150 };
        const result = rotateCrop(crop, imageSize, 'right', CAR_ASPECT);

        expect(result.width).toBeCloseTo(crop.width, 5);
        expect(result.height).toBeCloseTo(crop.height, 5);

        const expectedCenterX = imageSize.height - (crop.y + crop.height / 2);
        const expectedCenterY = crop.x + crop.width / 2;
        expect(result.x + result.width / 2).toBeCloseTo(expectedCenterX, 5);
        expect(result.y + result.height / 2).toBeCloseTo(expectedCenterY, 5);
    });

    it('stays within the rotated bounds when the mapped centre would otherwise push it out (clampCrop)', () => {
        const imageSize = { width: 800, height: 600 };
        // Valid in the original 800x600 frame (y is at the very top edge),
        // but a landscape crop's width is wider than its height, so mapping
        // its centre straight across pushes its far edge past the rotated
        // frame's 600px width — this is exactly the case `clampCrop` exists
        // to pull back.
        const nearEdge: CropRect = { x: 300, y: 0, width: 200, height: 150 };
        const result = rotateCrop(nearEdge, imageSize, 'right', CAR_ASPECT);

        expect(result.x).toBeGreaterThanOrEqual(0);
        expect(result.y).toBeGreaterThanOrEqual(0);
        const rotated = rotatedSize(imageSize, 90);
        expect(result.x + result.width).toBeLessThanOrEqual(rotated.width + 1e-9);
        expect(result.y + result.height).toBeLessThanOrEqual(rotated.height + 1e-9);
        // The size survives — only the position was out of bounds.
        expect(result.width).toBeCloseTo(200, 5);
        expect(result.height).toBeCloseTo(150, 5);
    });
});

describe('clampCrop', () => {
    const imageSize = { width: 1000, height: 500 };

    it('never leaves the image, however far the input is dragged off it', () => {
        const wayOffscreen = { x: -500, y: -500, width: 200, height: 200 };
        const result = clampCrop(wayOffscreen, imageSize, PORTRAIT_ASPECT);
        expect(result.x).toBeGreaterThanOrEqual(0);
        expect(result.y).toBeGreaterThanOrEqual(0);
        expect(result.x + result.width).toBeLessThanOrEqual(imageSize.width + 1e-9);
        expect(result.y + result.height).toBeLessThanOrEqual(imageSize.height + 1e-9);

        const wayPastTheFarEdge = { x: 2000, y: 2000, width: 200, height: 200 };
        const result2 = clampCrop(wayPastTheFarEdge, imageSize, PORTRAIT_ASPECT);
        expect(result2.x + result2.width).toBeLessThanOrEqual(imageSize.width + 1e-9);
        expect(result2.y + result2.height).toBeLessThanOrEqual(imageSize.height + 1e-9);
    });

    it('preserves the requested aspect ratio', () => {
        const crop = { x: 100, y: 100, width: 300, height: 123 };
        const square = clampCrop(crop, imageSize, PORTRAIT_ASPECT);
        expect(square.width / square.height).toBeCloseTo(PORTRAIT_ASPECT, 5);

        const landscape = clampCrop(crop, imageSize, CAR_ASPECT);
        expect(landscape.width / landscape.height).toBeCloseTo(CAR_ASPECT, 5);
    });

    it('grows a too-small crop to the minimum rather than leaving it tiny', () => {
        const tiny = { x: 400, y: 200, width: 4, height: 4 };
        const result = clampCrop(tiny, imageSize, PORTRAIT_ASPECT);
        expect(result.width).toBeGreaterThanOrEqual(MIN_CROP_SIZE - 1e-9);
        expect(result.height).toBeGreaterThanOrEqual(MIN_CROP_SIZE - 1e-9);
    });

    it('never grows a crop past the image it came from', () => {
        const biggerThanTheImage = { x: -1000, y: -1000, width: 5000, height: 5000 };
        const result = clampCrop(biggerThanTheImage, imageSize, PORTRAIT_ASPECT);
        expect(result.width).toBeLessThanOrEqual(imageSize.height + 1e-9); // the shorter edge, for a square crop
        expect(result.height).toBeLessThanOrEqual(imageSize.height + 1e-9);
    });

    it('is idempotent — clamping an already-valid crop leaves it unchanged', () => {
        const valid = fitInitialCrop(imageSize, CAR_ASPECT);
        const reclamped = clampCrop(valid, imageSize, CAR_ASPECT);
        expect(reclamped.x).toBeCloseTo(valid.x, 5);
        expect(reclamped.y).toBeCloseTo(valid.y, 5);
        expect(reclamped.width).toBeCloseTo(valid.width, 5);
        expect(reclamped.height).toBeCloseTo(valid.height, 5);
    });

    it('handles an image smaller than the minimum crop size without escaping it', () => {
        const tinyImage = { width: 20, height: 20 };
        const result = clampCrop({ x: 0, y: 0, width: 20, height: 20 }, tinyImage, PORTRAIT_ASPECT);
        expect(result.width).toBeLessThanOrEqual(tinyImage.width + 1e-9);
        expect(result.height).toBeLessThanOrEqual(tinyImage.height + 1e-9);
    });
});

describe('fitInitialCrop', () => {
    it('is centred in a wide image', () => {
        const imageSize = { width: 1000, height: 400 };
        const crop = fitInitialCrop(imageSize, PORTRAIT_ASPECT);
        expect(crop.x + crop.width / 2).toBeCloseTo(imageSize.width / 2, 5);
        expect(crop.y + crop.height / 2).toBeCloseTo(imageSize.height / 2, 5);
    });

    it('is centred in a tall image', () => {
        const imageSize = { width: 400, height: 1000 };
        const crop = fitInitialCrop(imageSize, CAR_ASPECT);
        expect(crop.x + crop.width / 2).toBeCloseTo(imageSize.width / 2, 5);
        expect(crop.y + crop.height / 2).toBeCloseTo(imageSize.height / 2, 5);
    });

    it('is the largest crop of that aspect the image can hold', () => {
        const imageSize = { width: 800, height: 600 };
        const crop = fitInitialCrop(imageSize, PORTRAIT_ASPECT);
        // A wider-than-square image is limited by its height.
        expect(crop.height).toBeCloseTo(imageSize.height, 5);
        expect(crop.width).toBeCloseTo(imageSize.height, 5);
    });

    it('preserves the requested aspect ratio', () => {
        const crop = fitInitialCrop({ width: 800, height: 600 }, CAR_ASPECT);
        expect(crop.width / crop.height).toBeCloseTo(CAR_ASPECT, 5);
    });
});

describe('outputSize', () => {
    it('downscales so the longer edge is at most maxEdge', () => {
        const crop = { x: 0, y: 0, width: 3000, height: 1500 };
        const size = outputSize(crop, 1024);
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1024);
        // Aspect preserved.
        expect(size.width / size.height).toBeCloseTo(crop.width / crop.height, 2);
    });

    it('never upscales a crop that is already smaller than maxEdge', () => {
        const crop = { x: 0, y: 0, width: 200, height: 150 };
        const size = outputSize(crop, 1024);
        expect(size).toEqual({ width: 200, height: 150 });
    });

    it('rounds to whole pixels', () => {
        const crop = { x: 0, y: 0, width: 333, height: 333 };
        const size = outputSize(crop, 100);
        expect(Number.isInteger(size.width)).toBe(true);
        expect(Number.isInteger(size.height)).toBe(true);
    });
});

describe('serializeImageEdit / parseImageEdit', () => {
    const edit: ImageEdit = { rotation: 90, crop: { x: 1, y: 2, width: 3, height: 4 } };

    it('round-trips exactly', () => {
        expect(parseImageEdit(serializeImageEdit(edit))).toEqual(edit);
    });

    it('is null for nothing on file', () => {
        expect(parseImageEdit(null)).toBeNull();
        expect(parseImageEdit(undefined)).toBeNull();
        expect(parseImageEdit('')).toBeNull();
    });

    it('is null for a value that is not JSON at all', () => {
        expect(parseImageEdit('not json')).toBeNull();
        expect(parseImageEdit('{"rotation": 90,')).toBeNull();
    });

    it('is null for JSON that does not parse to an object', () => {
        expect(parseImageEdit('42')).toBeNull();
        expect(parseImageEdit('"a string"')).toBeNull();
        expect(parseImageEdit('null')).toBeNull();
        expect(parseImageEdit('[1, 2, 3]')).toBeNull();
    });

    it('is null when rotation is not one of the four quarters', () => {
        expect(
            parseImageEdit(JSON.stringify({ rotation: 45, crop: edit.crop })),
        ).toBeNull();
        expect(
            parseImageEdit(JSON.stringify({ crop: edit.crop })),
        ).toBeNull();
    });

    it('is null when crop is missing or malformed', () => {
        expect(parseImageEdit(JSON.stringify({ rotation: 0 }))).toBeNull();
        expect(
            parseImageEdit(JSON.stringify({ rotation: 0, crop: { x: 1, y: 2 } })),
        ).toBeNull();
        expect(
            parseImageEdit(
                JSON.stringify({ rotation: 0, crop: { x: '1', y: 2, width: 3, height: 4 } }),
            ),
        ).toBeNull();
    });

    it('never throws on a malformed value, however it is malformed', () => {
        for (const bad of ['{', '{}', 'undefined', '{"rotation":90,"crop":null}']) {
            expect(() => parseImageEdit(bad)).not.toThrow();
        }
    });
});

describe('deriveScale', () => {
    const rotated = { width: 900, height: 600 };

    it('is 1 when there is no image yet', () => {
        expect(deriveScale(null, 420, 420)).toBe(1);
        expect(deriveScale(null, null, 420)).toBe(1);
    });

    it('falls back to intendedMaxEdge over the longest edge before a measurement exists', () => {
        expect(deriveScale(rotated, null, 420)).toBeCloseTo(420 / 900, 10);
        // A portrait image: the longest edge is still the divisor.
        expect(deriveScale({ width: 600, height: 900 }, null, 420)).toBeCloseTo(420 / 900, 10);
    });

    it('falls back the same way when the measurement is exactly zero', () => {
        // A container that hasn't been laid out yet (`getBoundingClientRect()`
        // before mount, or jsdom, which always reports 0) reads the same as
        // "no measurement" rather than producing a scale of zero.
        expect(deriveScale(rotated, 0, 420)).toBeCloseTo(420 / 900, 10);
    });

    it('prefers the measured width once one exists, even when it disagrees with intendedMaxEdge', () => {
        // The case this function exists for (#1094): a modal narrower than
        // the stage's intended width clamps the container's *rendered*
        // width below `intendedMaxEdge`, and the measured value — not the
        // constant — is what every on-screen/natural-pixel conversion has
        // to agree with.
        expect(deriveScale(rotated, 300, 420)).toBeCloseTo(300 / 900, 10);
    });

    it('matches the unmeasured fallback when the container is not actually clamped', () => {
        // The ordinary desktop case: the container rendered at exactly the
        // width the fallback formula would have guessed, so a caller cannot
        // tell measured and unmeasured apart.
        const measured = 420 / Math.max(rotated.width, rotated.height) * rotated.width;
        expect(deriveScale(rotated, measured, 420)).toBeCloseTo(
            deriveScale(rotated, null, 420),
            10,
        );
    });
});
