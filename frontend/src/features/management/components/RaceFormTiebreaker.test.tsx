// @vitest-environment jsdom
/**
 * How a tie is settled — `Race.tiebreaker` — is a control on `RaceForm`,
 * beside Scoring (#540 part d). `SHARED` is the default and every option's
 * description is always visible (#304), not only the one currently picked;
 * an option whose data this race cannot produce says so rather than being
 * hidden — a `POINTS` race on a `NONE`-timer track told `BEST_TIME` will
 * never fire.
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

type Track = { id: number; name: string; timerType?: string | null };

const tracksQuery = (tracks: Track[], fetching = false) => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks }, fetching, stale: false },
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
const submitSpy = () => vi.fn<(data: RaceFormData) => Promise<void>>(async () => {});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('the tiebreaker control', () => {
    it('defaults to Leave it shared, and every description is on screen at once', () => {
        tracksQuery([{ id: 1, name: 'Main Track', timerType: 'FAKE' }]);
        form(submitSpy());

        expect(screen.getByLabelText(/^Leave it shared/)).toBeChecked();
        // #304: not hidden until an option is selected.
        expect(
            screen.getByText(/Whoever's best recorded heat time is lowest wins the tie\./),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Whoever's heats add up to the least total time wins the tie\./),
        ).toBeInTheDocument();
        expect(screen.getByText(/Most 1st-place finishes wins/)).toBeInTheDocument();
        expect(
            screen.getByText(/whoever won more of the heats they actually shared wins the tie\./),
        ).toBeInTheDocument();
    });

    it('submits the chosen method', async () => {
        tracksQuery([{ id: 1, name: 'Main Track', timerType: 'FAKE' }]);
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        await userEvent.click(screen.getByLabelText(/^Countback/));
        await userEvent.click(submitButton());

        expect(onSubmit.mock.calls[0][0]).toMatchObject({ tiebreaker: 'COUNTBACK' });
    });

    it('starts from the race being edited, not the SHARED default', () => {
        tracksQuery([{ id: 3, name: 'Main Track', timerType: 'FAKE' }]);
        form(submitSpy(), { name: 'Existing Derby', track_id: 3, tiebreaker: 'BEST_TIME' });

        expect(screen.getByLabelText(/^Fastest single heat/)).toBeChecked();
        expect(screen.getByLabelText(/^Leave it shared/)).not.toBeChecked();
    });

    it('warns that a time-reading method will not fire on a Points race with no timer', async () => {
        tracksQuery([{ id: 1, name: 'No-Timer Track', timerType: 'NONE' }]);
        form(submitSpy());

        await userEvent.selectOptions(screen.getByLabelText('Scoring'), 'Points (1st=1pt, 2nd=2pts...)');

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).toHaveTextContent(/won.t fire for this race/i);
        const totalRow = screen.getByLabelText(/^Lowest total time/).closest('label')!;
        expect(totalRow).toHaveTextContent(/won.t fire for this race/i);

        // Countback reads places, which POINTS always has — no warning.
        const countbackRow = screen.getByLabelText(/^Countback/).closest('label')!;
        expect(countbackRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('gives no warning under Timed scoring, which always types a time by hand', async () => {
        tracksQuery([{ id: 1, name: 'No-Timer Track', timerType: 'NONE' }]);
        form(submitSpy());

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('gives no warning once a track with a real timer is selected', async () => {
        tracksQuery([
            { id: 1, name: 'No-Timer Track', timerType: 'NONE' },
            { id: 2, name: 'Fake Timer Track', timerType: 'FAKE' },
        ]);
        form(submitSpy());

        await userEvent.selectOptions(screen.getByLabelText('Scoring'), 'Points (1st=1pt, 2nd=2pts...)');
        await userEvent.selectOptions(screen.getByLabelText('Track / Timer'), 'Fake Timer Track');

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).not.toHaveTextContent(/won.t fire/i);
    });
});
