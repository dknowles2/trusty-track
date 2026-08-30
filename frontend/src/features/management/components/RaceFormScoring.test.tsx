// @vitest-environment jsdom
/**
 * Scoring and its drop-worst-runs modifier are controls on `RaceForm`
 * (#547 stage 3). Scoring offers all four strategies from
 * `backend.domain.scoring.ALL_STRATEGIES`, each with its one-line
 * description always visible (#304) — the same fieldset shape the Ties
 * control (#540 stage 3) already established. Drop worst runs sits beside
 * it: a number input, `0` off, whose own description states the
 * everybody-needs-enough-runs rule rather than leaving a configured-but-
 * silent modifier for the operator to puzzle over.
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

const tracksQuery = () => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 1, name: 'Main Track', timerType: 'FAKE' }] }, fetching: false, stale: false },
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

describe('the scoring control', () => {
    it('defaults to Timed, and every description is on screen at once', () => {
        tracksQuery();
        form(submitSpy());

        expect(screen.getByLabelText(/^Timed \(average\)/)).toBeChecked();
        // #304: not hidden until an option is selected.
        expect(
            screen.getByText(/A single bad run costs a little, not everything\./),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/1st place scores 1 point, 2nd scores 2/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Fair only while every racer runs the same number of heats/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/A bad run is never the one that's used/),
        ).toBeInTheDocument();
    });

    it('submits the chosen strategy, including the two new ones', async () => {
        tracksQuery();
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        await userEvent.click(screen.getByLabelText(/^Cumulative time \(total\)/));
        await userEvent.click(submitButton());

        expect(onSubmit.mock.calls[0][0]).toMatchObject({ scoring_strategy: 'CUMULATIVE_TIME' });
    });

    it('starts from the race being edited, not the Timed default', () => {
        tracksQuery();
        form(submitSpy(), { name: 'Existing Derby', track_id: 1, scoring_strategy: 'FASTEST_TIME' });

        expect(screen.getByLabelText(/^Fastest single run/)).toBeChecked();
        expect(screen.getByLabelText(/^Timed \(average\)/)).not.toBeChecked();
    });
});

describe('the drop-worst-runs control', () => {
    it('defaults to 0 and describes itself as off', () => {
        tracksQuery();
        form(submitSpy());

        expect(screen.getByLabelText('Drop worst run(s)')).toHaveValue(0);
        expect(screen.getByText(/^Off\. Set above 0/)).toBeInTheDocument();
    });

    it('describes the equal-counts rule once turned on', async () => {
        tracksQuery();
        form(submitSpy());

        await userEvent.clear(screen.getByLabelText('Drop worst run(s)'));
        await userEvent.type(screen.getByLabelText('Drop worst run(s)'), '1');

        expect(
            screen.getByText(/worst 1 counted result is dropped before scoring/),
        ).toBeInTheDocument();
        expect(screen.getByText(/at least 2 each/)).toBeInTheDocument();
    });

    it('pluralises for more than one', async () => {
        tracksQuery();
        form(submitSpy());

        await userEvent.clear(screen.getByLabelText('Drop worst run(s)'));
        await userEvent.type(screen.getByLabelText('Drop worst run(s)'), '2');

        expect(
            screen.getByText(/worst 2 counted results are dropped before scoring/),
        ).toBeInTheDocument();
        expect(screen.getByText(/at least 3 each/)).toBeInTheDocument();
    });

    it('submits the configured value', async () => {
        tracksQuery();
        const onSubmit = submitSpy();
        form(onSubmit);

        await userEvent.type(screen.getByLabelText('Event Name'), 'Pack 42 Derby');
        await userEvent.clear(screen.getByLabelText('Drop worst run(s)'));
        await userEvent.type(screen.getByLabelText('Drop worst run(s)'), '2');
        await userEvent.click(submitButton());

        expect(onSubmit.mock.calls[0][0]).toMatchObject({ drop_worst_runs: 2 });
    });

    it('starts from the race being edited', () => {
        tracksQuery();
        form(submitSpy(), { name: 'Existing Derby', track_id: 1, drop_worst_runs: 3 });

        expect(screen.getByLabelText('Drop worst run(s)')).toHaveValue(3);
    });

    it('never goes negative, even when cleared', async () => {
        tracksQuery();
        form(submitSpy());
        const input = screen.getByLabelText('Drop worst run(s)');

        await userEvent.clear(input);

        expect(input).toHaveValue(0);
    });
});
