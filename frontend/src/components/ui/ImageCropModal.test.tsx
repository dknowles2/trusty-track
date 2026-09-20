// @vitest-environment jsdom
import '../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageCropModal from './ImageCropModal';
import { PORTRAIT_ASPECT, rotateCrop, type CropRect } from './imageEdit';

/**
 * Issue #619, stage 1. The modal is standalone here — nothing wires it into
 * `CameraCapture` or `RacerForm` yet, so these tests drive it directly with
 * a data URL the way a later stage's caller will.
 *
 * jsdom does not decode images, so `naturalWidth`/`naturalHeight` are faked
 * on the `<img>` element and its `load` event is dispatched by hand — the
 * component only ever reads those two properties off the element it
 * rendered, so this is a faithful stand-in for a real photo loading.
 *
 * Canvas is mocked the same way: jsdom has no `HTMLCanvasElement` backend of
 * its own, so `getContext('2d')` returns `null` unless something stubs it.
 */

const DATA_URL = 'data:image/png;base64,AAAA';

function fakeContext() {
    return {
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
}

// `deriveScale`'s fallback is `DISPLAY_MAX / longest edge` — jsdom never
// measures a real container width, so every crop-box style in this file is
// drawn at that constant scale. 420 / 800 matches the 315px width the first
// test below already pins for the 600-natural-pixel default crop
// (315 / 600 = 0.525 = 420 / 800), and it stays the same after a quarter
// turn too: an 800x600 photo's longest edge is 800 whichever way round it
// is displayed, so nothing here has to track the rotation to know it.
const SCALE = 420 / 800;

/** Read a crop box's rendered style back into the natural-pixel `CropRect`
 * it was drawn from, undoing `SCALE` the same way `toNatural` would. */
function readCropRect(box: HTMLElement): CropRect {
    return {
        x: parseFloat(box.style.left) / SCALE,
        y: parseFloat(box.style.top) / SCALE,
        width: parseFloat(box.style.width) / SCALE,
        height: parseFloat(box.style.height) / SCALE,
    };
}

function loadImage(width = 800, height = 600) {
    const img = document.querySelector('img[alt="Photo being cropped"]') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
    fireEvent.load(img);
    return img;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ImageCropModal', () => {
    it('renders with a centred initial crop once the photo loads', () => {
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        expect(screen.getByText(/loading photo/i)).toBeInTheDocument();

        loadImage(800, 600);

        expect(screen.queryByText(/loading photo/i)).not.toBeInTheDocument();
        const cropBox = screen.getByRole('group', { name: /crop area/i });
        // A square crop of an 800x600 photo is limited by the shorter edge
        // (600 natural px), then scaled down with the rest of the stage —
        // 420 / 800 — to fit the display box.
        expect(cropBox).toHaveStyle({ width: '315px', height: '315px' });
    });

    it('rotating swaps the crop stage between portrait and landscape', () => {
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        const img = loadImage(800, 600);
        expect(img.style.transform).toContain('rotate(0deg)');

        fireEvent.click(screen.getByRole('button', { name: /rotate right/i }));
        expect(img.style.transform).toContain('rotate(90deg)');

        fireEvent.click(screen.getByRole('button', { name: /rotate right/i }));
        expect(img.style.transform).toContain('rotate(180deg)');

        fireEvent.click(screen.getByRole('button', { name: /rotate left/i }));
        expect(img.style.transform).toContain('rotate(90deg)');
    });

    it('rotating carries an existing crop through the turn instead of resetting it (#1240)', () => {
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        loadImage(800, 600);
        const cropBox = screen.getByRole('group', { name: /crop area/i });
        const defaultCrop = readCropRect(cropBox);

        // Nudge the crop off its default — arrow keys are the only keyboard
        // path there is (`handleKeyDown`/`handleCropKeyDown`). The default
        // crop is a 600x600 square inside an 800x600 image, so it already
        // touches the top and bottom edges (`clampCrop` holds `y` at 0) —
        // only `x` has room to move.
        fireEvent.keyDown(cropBox, { key: 'ArrowRight' });
        fireEvent.keyDown(cropBox, { key: 'ArrowRight' });
        const nudged = readCropRect(cropBox);
        expect(nudged.x).not.toBeCloseTo(defaultCrop.x, 1);

        // Rotation is still 0 at this point, so the crop is expressed in
        // the original, unrotated 800x600 image size.
        const imageSize = { width: 800, height: 600 };
        fireEvent.click(screen.getByRole('button', { name: /rotate right/i }));
        const afterRight = readCropRect(cropBox);
        const expected = rotateCrop(nudged, imageSize, 'right', PORTRAIT_ASPECT);
        expect(afterRight.x).toBeCloseTo(expected.x, 0);
        expect(afterRight.y).toBeCloseTo(expected.y, 0);
        expect(afterRight.width).toBeCloseTo(expected.width, 0);
        expect(afterRight.height).toBeCloseTo(expected.height, 0);
        // The mutation this guards against: `fitInitialCrop` would have put
        // the crop straight back at the default, regardless of rotation.
        expect(afterRight.x).not.toBeCloseTo(defaultCrop.x, 0);

        // Rotating the opposite way undoes it — back to the nudged crop,
        // not the default.
        fireEvent.click(screen.getByRole('button', { name: /rotate left/i }));
        const afterLeft = readCropRect(cropBox);
        expect(afterLeft.x).toBeCloseTo(nudged.x, 0);
        expect(afterLeft.y).toBeCloseTo(nudged.y, 0);
        expect(afterLeft.width).toBeCloseTo(nudged.width, 0);
        expect(afterLeft.height).toBeCloseTo(nudged.height, 0);
    });

    it('confirm draws to a canvas and calls onConfirm with a JPEG data URL and the edit that produced it', () => {
        const ctx = fakeContext();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        const toDataURL = vi
            .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
            .mockReturnValue('data:image/jpeg;base64,ZZZZ');

        const onConfirm = vi.fn();
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />,
        );
        loadImage(800, 600);

        fireEvent.click(screen.getByRole('button', { name: /use this photo/i }));

        expect(ctx.drawImage).toHaveBeenCalled();
        expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith(
            expect.stringMatching(/^data:image\/jpeg/),
            { rotation: 0, crop: expect.objectContaining({ width: expect.any(Number) }) },
        );
    });

    describe('seeding from a stored edit (#1241)', () => {
        it('applies the given rotation and crop once the photo loads, rather than the default centred crop', () => {
            render(
                <ImageCropModal
                    open
                    src={DATA_URL}
                    aspect={PORTRAIT_ASPECT}
                    initialRotation={90}
                    initialCrop={{ x: 50, y: 25, width: 300, height: 300 }}
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                />,
            );
            const img = loadImage(800, 600);

            // 90° of an 800x600 photo rotates the stage to 600x800 — the
            // image itself shows that rotation.
            expect(img.style.transform).toContain('rotate(90deg)');

            const cropBox = screen.getByRole('group', { name: /crop area/i });
            const applied = readCropRect(cropBox);
            expect(applied.x).toBeCloseTo(50, 0);
            expect(applied.y).toBeCloseTo(25, 0);
            expect(applied.width).toBeCloseTo(300, 0);
            expect(applied.height).toBeCloseTo(300, 0);
        });

        it('clamps a seeded crop that no longer fits — the original on disk might have been replaced', () => {
            render(
                <ImageCropModal
                    open
                    src={DATA_URL}
                    aspect={PORTRAIT_ASPECT}
                    initialRotation={0}
                    // Wildly out of bounds for the 800x600 photo this loads.
                    initialCrop={{ x: 10000, y: 10000, width: 50, height: 50 }}
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                />,
            );
            loadImage(800, 600);

            const cropBox = screen.getByRole('group', { name: /crop area/i });
            const applied = readCropRect(cropBox);
            // Pulled back inside the 800x600 frame — never outside it —
            // and grown to at least the minimum crop size, same as
            // `clampCrop` guarantees anywhere else it's called.
            expect(applied.x).toBeGreaterThanOrEqual(0);
            expect(applied.y).toBeGreaterThanOrEqual(0);
            expect(applied.x + applied.width).toBeLessThanOrEqual(800 + 1);
            expect(applied.y + applied.height).toBeLessThanOrEqual(600 + 1);
        });

        it('with no seed given, falls back to the ordinary default centred crop', () => {
            render(
                <ImageCropModal
                    open
                    src={DATA_URL}
                    aspect={PORTRAIT_ASPECT}
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                />,
            );
            loadImage(800, 600);

            const cropBox = screen.getByRole('group', { name: /crop area/i });
            expect(cropBox).toHaveStyle({ width: '315px', height: '315px' });
        });
    });

    it('cancel calls onCancel without confirming anything', () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={onCancel}
                onConfirm={onConfirm}
            />,
        );
        loadImage(800, 600);

        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('a pointercancel ends a drag the same way a pointerup does (#1094)', () => {
        // jsdom has no layout, so this can't prove the box moved *correctly*
        // (`photoCrop.spec.ts` does that, in a real browser) — it proves the
        // window-level `pointermove` listener a drag registers is actually
        // torn down when the gesture is cancelled rather than completed, which
        // jsdom can check perfectly well. Before this fix there was no
        // `pointercancel` listener at all: a cancelled gesture (a touch the
        // browser decides mid-drag is a scroll instead, say) left the
        // listener attached and `dragRef` pointing at a pointer that would
        // never send another event.
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        loadImage(800, 600);
        const cropBox = screen.getByRole('group', { name: /crop area/i });
        const styleBeforeDrag = cropBox.getAttribute('style');

        fireEvent.pointerDown(cropBox, { pointerId: 1, clientX: 10, clientY: 10 });
        // The drag is live: a move changes the box's own inline style.
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 30 });
        const styleMidDrag = cropBox.getAttribute('style');
        expect(styleMidDrag).not.toBe(styleBeforeDrag);

        fireEvent.pointerCancel(window, { pointerId: 1 });
        // A move after the cancel must be a no-op — the listener that would
        // have reacted to it is gone.
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 999, clientY: 999 });
        expect(cropBox.getAttribute('style')).toBe(styleMidDrag);
    });

    it('confirmLabel/cancelLabel override the default button wording (#1242)', () => {
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                confirmLabel="Save changes"
                cancelLabel="Keep original"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        loadImage(800, 600);

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep original' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^use this photo$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    });

    it('defaults to "Cancel" / "Use this photo" when no labels are given', () => {
        render(
            <ImageCropModal
                open
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        loadImage(800, 600);

        expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^use this photo$/i })).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        const { container } = render(
            <ImageCropModal
                open={false}
                src={DATA_URL}
                aspect={PORTRAIT_ASPECT}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
