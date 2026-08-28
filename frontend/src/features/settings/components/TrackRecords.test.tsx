import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertProvider } from '../../../context/AlertContext';
import { useMutation } from 'urql';
import TrackRecords, { type HistoricalRecord } from './TrackRecords';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn() };
});

const executeMutation = vi.fn();

function mockMutations() {
    (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockReturnValue([
        { fetching: false },
        executeMutation,
    ]);
}

function renderRecords(records: HistoricalRecord[] = [], onChange = vi.fn()) {
    mockMutations();
    render(
        <AlertProvider>
            <TrackRecords trackId={7} records={records} onChange={onChange} />
        </AlertProvider>,
    );
    return onChange;
}

const jimmy: HistoricalRecord = {
    id: 3,
    timeSeconds: 2.89,
    racerName: 'Jimmy Legend',
    carNumber: 42,
    raceName: 'Derby 2019',
    raceDate: '2019-03-16',
};

afterEach(() => vi.clearAllMocks());

describe('TrackRecords', () => {
    it('lists a record the way it will be announced', () => {
        renderRecords([jimmy]);
        expect(screen.getByText('2.890s')).toBeInTheDocument();
        expect(
            screen.getByText(/Jimmy Legend \(Car #42\) — Derby 2019, 2019-03-16/),
        ).toBeInTheDocument();
    });

    it('adds a record and hands the saved row back sorted', async () => {
        const saved = { ...jimmy, id: 9, timeSeconds: 3.2, racerName: 'New Kid' };
        executeMutation.mockResolvedValue({ data: { createTrackRecord: saved } });
        const onChange = renderRecords([jimmy]);

        await userEvent.type(screen.getByLabelText(/record time/i), '3.2');
        await userEvent.type(screen.getByLabelText(/who set the record/i), 'New Kid');
        await userEvent.click(screen.getByRole('button', { name: /add record/i }));

        expect(executeMutation).toHaveBeenCalledWith({
            trackId: 7,
            record: {
                timeSeconds: 3.2,
                racerName: 'New Kid',
                carNumber: null,
                raceName: null,
                raceDate: null,
            },
        });
        expect(onChange).toHaveBeenCalledWith([jimmy, saved]);
    });

    it('refuses a zero time with a sentence, before any request', async () => {
        renderRecords();

        await userEvent.type(screen.getByLabelText(/record time/i), '0');
        await userEvent.type(screen.getByLabelText(/who set the record/i), 'Nobody');
        await userEvent.click(screen.getByRole('button', { name: /add record/i }));

        expect(
            await screen.findByText(/must be more than zero seconds/i),
        ).toBeInTheDocument();
        expect(executeMutation).not.toHaveBeenCalled();
    });

    it('refuses a blank name before any request', async () => {
        renderRecords();

        await userEvent.type(screen.getByLabelText(/record time/i), '3.0');
        await userEvent.click(screen.getByRole('button', { name: /add record/i }));

        expect(
            await screen.findByText(/names the racer who set it/i),
        ).toBeInTheDocument();
        expect(executeMutation).not.toHaveBeenCalled();
    });

    it('shows an error toast, and does not call onChange, when saving fails (#436)', async () => {
        executeMutation.mockResolvedValue({
            error: { graphQLErrors: [{ message: 'A record time must be positive.' }] },
        });
        const onChange = renderRecords([jimmy]);

        await userEvent.type(screen.getByLabelText(/record time/i), '3.2');
        await userEvent.type(screen.getByLabelText(/who set the record/i), 'New Kid');
        await userEvent.click(screen.getByRole('button', { name: /add record/i }));

        expect(await screen.findByText('A record time must be positive.')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('removes a record on its ✕', async () => {
        executeMutation.mockResolvedValue({ data: { deleteTrackRecord: true } });
        const onChange = renderRecords([jimmy]);

        await userEvent.click(
            screen.getByRole('button', { name: /remove the record held by jimmy legend/i }),
        );

        expect(executeMutation).toHaveBeenCalledWith({ recordId: 3 });
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('edits in place: the pencil loads the form and Save change updates', async () => {
        const corrected = { ...jimmy, timeSeconds: 2.91 };
        executeMutation.mockResolvedValue({ data: { updateTrackRecord: corrected } });
        const onChange = renderRecords([jimmy]);

        await userEvent.click(
            screen.getByRole('button', { name: /edit the record held by jimmy legend/i }),
        );
        const time = screen.getByLabelText(/record time/i);
        expect(time).toHaveValue(2.89);
        await userEvent.clear(time);
        await userEvent.type(time, '2.91');
        await userEvent.click(screen.getByRole('button', { name: /save change/i }));

        expect(executeMutation).toHaveBeenCalledWith({
            recordId: 3,
            record: {
                timeSeconds: 2.91,
                racerName: 'Jimmy Legend',
                carNumber: 42,
                raceName: 'Derby 2019',
                raceDate: '2019-03-16',
            },
        });
        expect(onChange).toHaveBeenCalledWith([corrected]);
    });
});
