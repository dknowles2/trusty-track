// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

import { useQuery, useMutation } from 'urql';
import RacerForm from './RacerForm';
import { AlertProvider } from '../../../context/AlertContext';

/**
 * Issue #1241, review finding 2: `CameraCapture.test.tsx` only proved the
 * raw frame and the cropped result reach `onCapture` as two distinct
 * `File` objects — it never proved which one lands where once `RacerForm`
 * uploads them. A bug that uploaded the *cropped* result as both the
 * original and the image would have passed every test that existed before
 * this file, because nothing checked that the first `uploadImage` call's
 * returned URL becomes `racer_image_original_url` and the second's becomes
 * `racer_image_url` — only that two uploads happened.
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

beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { race: { racingGroups: [] } }, fetching: false, stale: false },
        vi.fn(),
    ] as never);
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: undefined,
    });
});

it('a camera capture uploads the raw frame as the original and the cropped result as the image, in that order (#1241)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
    // Two distinguishable canvases, called in order: the raw-frame capture
    // canvas in `CameraCapture.handleCapture`, then `ImageCropModal`'s own
    // confirm canvas — the same technique `CameraCapture.test.tsx` uses,
    // carried one layer up so the *uploaded* URLs, not just the `File`
    // objects, are what gets checked.
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
    toDataURL.mockReturnValueOnce('data:image/jpeg;base64,UkFXRlJBTUU='); // "RAWFRAME"
    toDataURL.mockReturnValueOnce('data:image/jpeg;base64,Q1JPUFBFRA=='); // "CROPPED"

    const uploadImageMutation = vi
        .fn()
        .mockResolvedValueOnce({ data: { uploadImage: '/static/uploaded-original.jpg' } })
        .mockResolvedValueOnce({ data: { uploadImage: '/static/uploaded-cropped.jpg' } });
    vi.mocked(useMutation).mockReturnValue([
        { fetching: false, stale: false },
        uploadImageMutation,
    ] as never);

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
        <AlertProvider>
            <RacerForm raceId={1} onSubmit={onSubmit} onCancel={vi.fn()} />
        </AlertProvider>,
    );

    await userEvent.type(screen.getByLabelText('First Name'), 'Riley');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Fast');

    // The racer photo panel's camera button — the first of the two
    // ("📷 Camera" also appears in the car photo panel below it).
    await userEvent.click(screen.getAllByRole('button', { name: /camera/i })[0]);
    await screen.findByRole('button', { name: /^capture$/i });
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));

    await screen.findByRole('dialog', { name: /crop photo/i });
    loadCroppedPhoto();
    fireEvent.click(screen.getByRole('button', { name: /use this photo/i }));

    // Two uploads, sequential (not `Promise.all` — CLAUDE.md's "Two
    // concurrent mutations with identical variables" note): the second
    // does not fire until the first has resolved, so waiting for both
    // calls also proves the ordering held rather than a race.
    await waitFor(() => {
        expect(uploadImageMutation).toHaveBeenCalledTimes(2);
    });

    const firstDataUrl = uploadImageMutation.mock.calls[0][0].dataUrl as string;
    const secondDataUrl = uploadImageMutation.mock.calls[1][0].dataUrl as string;
    expect(firstDataUrl).toContain('UkFXRlJBTUU=');
    expect(secondDataUrl).toContain('Q1JPUFBFRA==');

    // The preview updates to the *second* upload's URL — the cropped
    // result, not the raw frame.
    expect(await screen.findByAltText('Racer')).toHaveAttribute(
        'src',
        '/static/uploaded-cropped.jpg',
    );

    await userEvent.click(screen.getByRole('button', { name: /^save racer$/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    // The first upload's returned URL — the raw frame's — is the original;
    // the second's — the cropped result's — is the image. Swapping these
    // two in `RacerForm.tsx`'s `uploadCapture` is exactly the review's
    // finding-2 mutation, and this is the assertion that catches it.
    expect(submitted.racer_image_url).toBe('/static/uploaded-cropped.jpg');
    expect(submitted.racer_image_original_url).toBe('/static/uploaded-original.jpg');
    expect(JSON.parse(submitted.racer_image_edit)).toMatchObject({
        rotation: 0,
        crop: expect.any(Object),
    });
});
