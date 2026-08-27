// @vitest-environment jsdom
/**
 * A race must name a track, and the form must not submit before it has one.
 *
 * `trackId` is derived as `formData.track_id || tracks[0]?.id || 0`, so while
 * the tracks query is in flight it is 0. Nothing stopped the form being
 * submitted in that window: the insert failed the foreign key on
 * `races.track_id` and the operator saw only "Failed to create race", with
 * nothing saying what was wrong. Rare by hand, reliable when the query is slow
 * — which a Raspberry Pi at a venue is.
 *
 * The same 0 covers an install with no tracks at all (deleting the last track
 * is allowed while no race uses it), so both are pinned here.
 */
import '../../../setupTests';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useQuery: vi.fn() };
});

import { useQuery } from 'urql';
import RaceForm, { RaceFormData } from './RaceForm';

type Track = { id: number; name: string };

const tracksQuery = (tracks: Track[] | null, fetching = false) => {
    vi.mocked(useQuery).mockReturnValue([
        { data: tracks === null ? undefined : { tracks }, fetching, stale: false },
        vi.fn(),
    ] as never);
};

const form = (onSubmit: (data: RaceFormData) => Promise<void>, initialData?: Partial<RaceFormData>) =>
    render(
        <RaceForm
            initialData={initialData}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            submitLabel="Create Race"
        />,
    );

const submitButton = () => screen.getByRole('button', { name: 'Create Race' });

/** Typed so the assertions below can read the payload the form sent. */
const submitSpy = () => vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('creating a race before the tracks have loaded', () => {
    it('will not submit while the tracks query is still in flight', async () => {
        tracksQuery(null, true);
        const onSubmit = submitSpy();
        form(onSubmit);

        expect(submitButton()).toBeDisabled();

        await userEvent.type(screen.getByLabelText('Event Name'), 'Slow Query Derby');
        await userEvent.click(submitButton());

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('will not submit on Enter either, which a disabled button need not stop', async () => {
        tracksQuery(null, true);
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Slow Query Derby{Enter}');

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits once a track has arrived, and names it', async () => {
        tracksQuery([{ id: 7, name: 'Main Track' }]);
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        await userEvent.click(submitButton());

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toMatchObject({
            name: 'Pack 42 Derby',
            track_id: 7,
        });
    });
});

describe('an install with no tracks at all', () => {
    it('says so, in words an operator can act on', () => {
        tracksQuery([]);
        form(submitSpy());

        expect(screen.getByTestId('no-tracks')).toHaveTextContent(
            'You have no tracks yet. Add one in System Settings',
        );
        expect(submitButton()).toBeDisabled();
    });

    it('never posts a track of 0', async () => {
        tracksQuery([]);
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Trackless Derby{Enter}');

        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe('editing a race that already names a track', () => {
    it('is submittable while the tracks query is still in flight', async () => {
        // Editing is not creating: the race's own track is in `initialData`,
        // so there is nothing to wait for and blocking the save would be a
        // regression of its own.
        tracksQuery(null, true);
        const onSubmit = submitSpy();
        form(onSubmit, { name: 'Existing Derby', track_id: 3 });

        await userEvent.click(submitButton());

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ track_id: 3 });
    });
});
