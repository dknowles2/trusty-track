// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn(), useMutation: vi.fn() };
});

import { useQuery, useMutation } from 'urql';
import RacerForm from './RacerForm';
import { AlertProvider } from '../../../context/AlertContext';

/**
 * Issue #619 stage 3: a photo already on file — uploaded rather than just
 * taken through `CameraCapture` — gets its own rotate/recrop control on
 * `RacerForm`'s existing preview. jsdom has no canvas backend, so both
 * `getContext('2d')` and `toDataURL` are mocked the same way
 * `ImageCropModal.test.tsx` and `CameraCapture.test.tsx` mock them.
 */

function fakeContext() {
    return {
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
}

function loadPhotoBeingCropped(width = 800, height = 600) {
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
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const initialData = {
    first_name: 'Jordan',
    last_name: 'Mitchell',
    car_passed_inspection: true,
    excluded_from_standings: false,
    racer_image_url: '/static/racer-original.jpg',
    car_image_url: '/static/car-original.jpg',
};

describe('rotating an already-uploaded photo', () => {
    it('has no control when there is no photo on file yet', () => {
        vi.mocked(useMutation).mockReturnValue([{ fetching: false, stale: false }, vi.fn()] as never);
        render(
            <AlertProvider>
                <RacerForm raceId={1} onSubmit={vi.fn()} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        expect(screen.queryByRole('button', { name: /rotate \/ recrop/i })).not.toBeInTheDocument();
    });

    it('uploads the straightened result as a new photo, through the same upload path as a fresh file', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
            'data:image/jpeg;base64,QUJD',
        );
        const uploadImageMutation = vi.fn().mockResolvedValue({
            data: { uploadImage: '/static/racer-straightened.jpg' },
        });
        vi.mocked(useMutation).mockReturnValue([
            { fetching: false, stale: false },
            uploadImageMutation,
        ] as never);

        render(
            <AlertProvider>
                <RacerForm raceId={1} initialData={initialData} onSubmit={vi.fn()} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        const buttons = screen.getAllByRole('button', { name: /rotate \/ recrop/i });
        expect(buttons).toHaveLength(2);
        await userEvent.click(buttons[0]);

        expect(screen.getByRole('dialog', { name: /rotate \/ recrop photo/i })).toBeInTheDocument();

        loadPhotoBeingCropped();
        await userEvent.click(screen.getByRole('button', { name: /use this photo/i }));

        // The modal is gone, and the upload mutation ran with a fresh data
        // URL — the same door `uploadFile` already opens for a chosen file
        // or a fresh camera capture, not a second path that edits the
        // stored URL in place.
        expect(screen.queryByRole('dialog', { name: /rotate \/ recrop photo/i })).not.toBeInTheDocument();
        expect(uploadImageMutation).toHaveBeenCalledTimes(1);
        expect(uploadImageMutation.mock.calls[0][0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);

        expect(await screen.findByAltText('Racer')).toHaveAttribute(
            'src',
            '/static/racer-straightened.jpg',
        );
    });

    it('cancelling leaves the stored photo untouched', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
            'data:image/jpeg;base64,QUJD',
        );
        const uploadImageMutation = vi.fn();
        vi.mocked(useMutation).mockReturnValue([
            { fetching: false, stale: false },
            uploadImageMutation,
        ] as never);

        render(
            <AlertProvider>
                <RacerForm raceId={1} initialData={initialData} onSubmit={vi.fn()} onCancel={vi.fn()} />
            </AlertProvider>,
        );

        const carButton = screen.getAllByRole('button', { name: /rotate \/ recrop/i })[1];
        await userEvent.click(carButton);
        loadPhotoBeingCropped();

        const dialog = screen.getByRole('dialog', { name: /rotate \/ recrop photo/i });
        await userEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

        expect(screen.queryByRole('dialog', { name: /rotate \/ recrop photo/i })).not.toBeInTheDocument();
        expect(uploadImageMutation).not.toHaveBeenCalled();
        expect(screen.getByAltText('Car')).toHaveAttribute('src', '/static/car-original.jpg');
    });
});
