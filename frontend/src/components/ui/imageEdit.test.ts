import { describe, it, expect } from 'vitest';
import {
    rotateQuarter,
    rotatedSize,
    clampCrop,
    fitInitialCrop,
    outputSize,
    PORTRAIT_ASPECT,
    CAR_ASPECT,
    MIN_CROP_SIZE,
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
