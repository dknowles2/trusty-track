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
            screen.getByText(/Tied cars share the place — two 1sts, then 3rd\./),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/The tied car with the single fastest heat wins\./),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/The tied car whose heat times add up to less wins\./),
        ).toBeInTheDocument();
        expect(screen.getByText(/Compares finishing places, not times/)).toBeInTheDocument();
        expect(
            screen.getByText(/Looks only at heats where the tied cars raced each other/),
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

        await userEvent.click(screen.getByLabelText(/^Points \(by finish\)/));

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).toHaveTextContent(/won.t fire for this race/i);
        const totalRow = screen.getByLabelText(/^Lowest total time/).closest('label')!;
        expect(totalRow).toHaveTextContent(/won.t fire for this race/i);

        // Countback reads places, which POINTS always has — no warning.
        const countbackRow = screen.getByLabelText(/^Countback/).closest('label')!;
        expect(countbackRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('gives no warning for Fastest single heat under Timed scoring, which always types a time by hand', async () => {
        tracksQuery([{ id: 1, name: 'No-Timer Track', timerType: 'NONE' }]);
        form(submitSpy());

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('gives no warning for Lowest total time under Timed (average) scoring — a disrupted round can leave it useful (#1089 review)', () => {
        // A first version of this rule claimed Timed (average) makes
        // Lowest total time a no-op, on the premise that a disrupted round
        // is dropped from standings. That premise is backwards — a
        // disrupted round (a lane outage, #171; a latecomer, #172) is
        // *kept* under Timed, so two tied racers can have run a different
        // number of heats and still average the same, while their raw
        // totals differ. Never flagged, regardless of timer.
        tracksQuery([{ id: 1, name: 'Fake Timer Track', timerType: 'FAKE' }]);
        form(submitSpy());

        const totalRow = screen.getByLabelText(/^Lowest total time/).closest('label')!;
        expect(totalRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('warns that Lowest total time cannot fire under Cumulative time scoring, only while nothing is being dropped', async () => {
        // Cumulative time sums every counted time, which is exactly what
        // Lowest total time compares — but only when drop_worst_runs is
        // off. With a drop active, Cumulative time scores the *post-drop*
        // sum while Lowest total time still sums the raw, undropped list,
        // so the two can disagree (#1089 review).
        tracksQuery([{ id: 1, name: 'Fake Timer Track', timerType: 'FAKE' }]);
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Cumulative time \(total\)/));

        const totalRow = screen.getByLabelText(/^Lowest total time/).closest('label')!;
        expect(totalRow).toHaveTextContent(/won.t fire for this race/i);

        await userEvent.clear(screen.getByLabelText('Drop worst run(s)'));
        await userEvent.type(screen.getByLabelText('Drop worst run(s)'), '1');

        expect(totalRow).not.toHaveTextContent(/won.t fire/i);
    });

    it('gives no warning once a track with a real timer is selected', async () => {
        tracksQuery([
            { id: 1, name: 'No-Timer Track', timerType: 'NONE' },
            { id: 2, name: 'Fake Timer Track', timerType: 'FAKE' },
        ]);
        form(submitSpy());

        await userEvent.click(screen.getByLabelText(/^Points \(by finish\)/));
        await userEvent.selectOptions(screen.getByLabelText('Track / Timer'), 'Fake Timer Track');

        const fastestRow = screen.getByLabelText(/^Fastest single heat/).closest('label')!;
        expect(fastestRow).not.toHaveTextContent(/won.t fire/i);
    });
});
