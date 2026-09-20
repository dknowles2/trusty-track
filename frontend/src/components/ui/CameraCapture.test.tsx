// @vitest-environment jsdom
import '../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CameraCapture from './CameraCapture';
import { CAR_ASPECT, PORTRAIT_ASPECT } from './imageEdit';

// #593: over an insecure origin (TRUSTYTRACK_HTTP_ONLY, or a second device
// reached by plain http://<lan-ip>), `navigator.mediaDevices` does not exist
// at all. Calling straight into it throws a bare TypeError that reads, to a
// volunteer, exactly like a permissions refusal — the wrong thing to
// troubleshoot when the real cause is the connection. These pin the two
// messages apart.

/**
 * Stage 2 of #619 hooks the capture flow into `ImageCropModal`. jsdom has no
 * canvas backend of its own — `getContext('2d')` returns `null` and
 * `toDataURL` returns a placeholder unless something stubs them — so both
 * are mocked the same way `ImageCropModal.test.tsx` mocks them, and both the
 * component's own capture canvas and the crop modal's confirm canvas share
 * one mocked `toDataURL` result.
 */

function fakeContext() {
    return {
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
}

function fakeStream(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

function loadCroppedPhoto(width = 800, height = 600) {
    const img = document.querySelector('img[alt="Photo being cropped"]') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
    fireEvent.load(img);
}

async function renderWithCamera(aspect: number = PORTRAIT_ASPECT) {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
    });
    const onCapture = vi.fn();
    const onClose = vi.fn();
    render(<CameraCapture onCapture={onCapture} onClose={onClose} aspect={aspect} />);
    await screen.findByRole('button', { name: /^capture$/i });
    return { onCapture, onClose };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: undefined,
    });
});

it('explains the secure-connection requirement over an explicitly insecure origin', () => {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: false,
    });
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });

    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} aspect={PORTRAIT_ASPECT} />);

    expect(screen.getByText(/needs a secure connection/)).toBeInTheDocument();
    // Never even asked — no permissions prompt to blame.
    expect(getUserMedia).not.toHaveBeenCalled();
});

it('still reports the ordinary permissions message when the origin is secure', async () => {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} aspect={PORTRAIT_ASPECT} />);

    expect(
        await screen.findByText(/Could not access camera\. Please ensure permissions/),
    ).toBeInTheDocument();
});

describe('the crop step', () => {
    it('opens after Capture, and confirming it hands onCapture the cropped result, the raw frame, and the edit (#1241)', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
        // Two *distinguishable* canvases produce the two uploads this flow
        // sends — the raw-frame capture canvas in `handleCapture`, then
        // `ImageCropModal`'s own confirm canvas — called in that order, and
        // exactly once each, over the course of this test. A single shared
        // mock return value (the original shape of this test) made
        // `result.original`/`result.file` differ only by filename: a bug
        // that uploaded the *cropped* result as both `original` and `file`
        // — discarding the raw frame entirely — passed every assertion
        // here, because nothing checked the bytes. `mockReturnValueOnce`
        // twice, in call order, is what a content-based assertion needs.
        const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
        toDataURL.mockReturnValueOnce('data:image/jpeg;base64,UkFXRlJBTUU='); // "RAWFRAME"
        toDataURL.mockReturnValueOnce('data:image/jpeg;base64,Q1JPUFBFRA=='); // "CROPPED"

        const { onCapture, onClose } = await renderWithCamera(CAR_ASPECT);

        fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));

        // The viewfinder is gone — this is the crop step now, not a second
        // overlay stacked on top of it.
        expect(screen.queryByText(/take photo/i)).not.toBeInTheDocument();
        const dialog = screen.getByRole('dialog', { name: /crop photo/i });
        expect(dialog).toBeInTheDocument();

        // `CameraCapture` passes no `confirmLabel`/`cancelLabel` — a
        // first-time capture keeps `ImageCropModal`'s own defaults (#1242),
        // separately pinned from `RacerFormRotate.test.tsx`'s "Keep
        // original" / "Save changes" recrop pair so the two vocabularies
        // can't drift into each other unnoticed.
        expect(within(dialog).getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /use this photo/i })).toBeInTheDocument();

        loadCroppedPhoto();
        fireEvent.click(screen.getByRole('button', { name: /use this photo/i }));

        expect(onCapture).toHaveBeenCalledTimes(1);
        const result = onCapture.mock.calls[0][0] as {
            file: File;
            original: File;
            edit: { rotation: number; crop: unknown };
        };

        expect(result.file).toBeInstanceOf(File);
        expect(result.file.type).toBe('image/jpeg');
        expect(result.file.name).toMatch(/^capture-\d+\.jpg$/);
        // The *content*, not just the filename — this is the assertion
        // that actually distinguishes "uploaded the cropped result" from
        // "uploaded the raw frame a second time" (#1241 review, finding 2).
        await expect(result.file.text()).resolves.toBe('CROPPED');

        // The raw frame — the original — is a *separate* file from the
        // cropped result, not the same bytes twice (#1241): a caller that
        // uploads both ends up with an original a later recrop can
        // actually recover something from.
        expect(result.original).toBeInstanceOf(File);
        expect(result.original.name).toMatch(/^capture-original-\d+\.jpg$/);
        expect(result.original).not.toBe(result.file);
        await expect(result.original.text()).resolves.toBe('RAWFRAME');

        expect(result.edit.rotation).toBe(0);
        expect(result.edit.crop).toBeTruthy();

        // Closing is the caller's job (RacerForm tears the whole component
        // down once `onCapture` returns) — this component itself neither
        // closes nor re-requests the camera on a successful crop.
        expect(onClose).not.toHaveBeenCalled();
    });

    it('cancelling the crop returns to the same viewfinder, with nothing reported', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
            'data:image/jpeg;base64,QUJD',
        );
        const { onCapture, onClose } = await renderWithCamera();

        fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
        loadCroppedPhoto();

        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

        expect(await screen.findByText(/take photo/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^capture$/i })).toBeInTheDocument();
        expect(onCapture).not.toHaveBeenCalled();
        // Cancelling the crop is not the same as cancelling the camera —
        // the operator is retaking the photo, not backing out of the flow.
        expect(onClose).not.toHaveBeenCalled();
    });
});
