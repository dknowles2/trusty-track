// @vitest-environment jsdom
import '../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageCropModal from './ImageCropModal';
import { PORTRAIT_ASPECT } from './imageEdit';

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

    it('confirm draws to a canvas and calls onConfirm with a JPEG data URL', () => {
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
        expect(onConfirm).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg/));
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
