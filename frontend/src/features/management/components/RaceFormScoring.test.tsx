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

const tracksQuery = (timerType: string = 'FAKE') => {
    vi.mocked(useQuery).mockReturnValue([
        { data: { tracks: [{ id: 1, name: 'Main Track', timerType }] }, fetching: false, stale: false },
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

describe('the no-timer note (#1324)', () => {
    // Timed's Enter Results modal takes a hand-typed time only
    // (`showsPlaceColumn` in `RaceExecution.tsx`) — with no track timer at
    // all there is no way to record a finishing order, and nothing said so
    // until the first heat. `scoringNeedsATimerNote` is the predicate;
    // this is the same note reached through `RaceForm`, for both a race
    // being created (which is what the setup wizard's Details step is) and
    // one being edited.
    const NOTE = /no electronic timer/i;

    it('shows the note for a Timed race on a track with no timer — the default scoring strategy', () => {
        tracksQuery('NONE');
        form(submitSpy());

        expect(screen.getByLabelText(/^Timed \(average\)/)).toBeChecked();
        expect(screen.getByText(NOTE)).toBeInTheDocument();
    });

    it('says nothing once a track with a real timer is selected', () => {
        tracksQuery('FAKE');
        form(submitSpy());

        expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    });

    it('says nothing once Points is chosen — that combination already works', async () => {
        tracksQuery('NONE');
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Points \(by finish\)/));

        expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    });

    it('reappears switching back to Timed', async () => {
        tracksQuery('NONE');
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Points \(by finish\)/));
        await userEvent.click(screen.getByLabelText(/^Timed \(average\)/));

        expect(screen.getByText(NOTE)).toBeInTheDocument();
    });

    it('appears when editing an existing Timed race whose track has no timer — the same signpost, not only at creation', () => {
        // The issue's own reason for putting this in the edit form too: a
        // race can be edited after creation, or its track's timer type can
        // change later. Neither is the moment the race was first set up.
        tracksQuery('NONE');
        form(submitSpy(), { name: 'Existing Derby', track_id: 1, scoring_strategy: 'TIMED' });

        expect(screen.getByText(NOTE)).toBeInTheDocument();
    });

    it('the existing Points + no-timer tiebreaker warning still fires alongside it', async () => {
        // Guards against the two predicates (`scoringNeedsATimerNote` and
        // `tiebreakerWontFire`) contradicting or duplicating one another —
        // this one is genuinely a different question (can the scoring
        // strategy record a result at all vs. can a tiebreak method settle
        // a tie) and both can legitimately be on screen together.
        tracksQuery('NONE');
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Points \(by finish\)/));

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).toHaveTextContent(/won.t fire for this race/i);
        expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    });

    it('also shows the note for Cumulative time on a no-timer track — it shares Timed\'s missing-Place-column gap', async () => {
        // #1324 review: a first version fired only for Timed. Cumulative
        // time and Fastest single run are exactly as time-based
        // (`isTimeBasedStrategy`) and hit the identical Enter Results
        // shape, so a no-timer pack that lands on either finds no way to
        // record a finishing order either — with no signpost, before this.
        tracksQuery('NONE');
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Cumulative time \(total\)/));

        expect(screen.getByText(NOTE)).toBeInTheDocument();
        // Not the Timed-specific half of the wording — the operator is
        // already on a time-based strategy, so "Choose Timed" would point
        // at a third option nobody asked about.
        expect(screen.getByText(NOTE)).not.toHaveTextContent(/choose timed/i);
        expect(screen.getByText(NOTE)).toHaveTextContent(/judging finish order by eye\? choose points\./i);
    });

    it('and for Fastest single run on a no-timer track', async () => {
        tracksQuery('NONE');
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Fastest single run/));

        expect(screen.getByText(NOTE)).toBeInTheDocument();
    });
});
