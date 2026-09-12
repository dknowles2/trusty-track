// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from 'urql';
import ImportRacersModal from './ImportRacersModal';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

/** The mutation, and what it was called with. */
function mockImport(imported = 2) {
    const execute = vi.fn().mockResolvedValue({ data: { importRacers: imported } });
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{}, execute]);
    return execute;
}

async function selectFile(contents: string, name = 'roster.csv') {
    const input = document.getElementById('csv-upload-input') as HTMLInputElement;
    await userEvent.upload(input, new File([contents], name, { type: 'text/csv' }));
    // FileReader is async; the mapping form appears once it resolves.
    await waitFor(() => expect(screen.getByText('Match your columns')).toBeInTheDocument());
}

const open = (onImportSuccess = vi.fn()) =>
    render(
        <ImportRacersModal
            isOpen
            onClose={vi.fn()}
            raceId={1}
            onImportSuccess={onImportSuccess}
        />,
    );

describe('ImportRacersModal', () => {
    it('guesses the mapping from the operator’s own headers', async () => {
        mockImport();
        open();

        await selectFile('Scout First,Scout Last,Car #\nAlex,Rivera,7');

        expect((screen.getByLabelText('First Name') as HTMLSelectElement).value).toBe('Scout First');
        expect((screen.getByLabelText('Last Name') as HTMLSelectElement).value).toBe('Scout Last');
        expect((screen.getByLabelText('Car Number') as HTMLSelectElement).value).toBe('Car #');
    });

    it('previews the rows as they would import', async () => {
        mockImport();
        open();

        await selectFile('Scout First,Scout Last\nAlex,Rivera\nSam,Okafor');

        expect(screen.getByText('Alex')).toBeInTheDocument();
        expect(screen.getByText('Okafor')).toBeInTheDocument();
    });

    it('sends the canonical headers rather than the file', async () => {
        // The whole point of rebuilding it: the backend gets what the preview
        // showed, whatever the operator's column names were.
        const execute = mockImport();
        open();

        await selectFile('Scout First,Scout Last,Car #\nAlex,Rivera,7');
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(execute).toHaveBeenCalled());
        expect(execute.mock.calls[0][0].csvData).toBe(
            'first_name,last_name,car_number\nAlex,Rivera,7',
        );
    });

    it('will not import until both name fields are mapped', async () => {
        mockImport();
        open();

        // One column holding a whole name: nothing can map to Last Name.
        await selectFile('Racer\nAlex Rivera');

        expect(screen.getByText('This file cannot be imported yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled();
    });

    it('lets the operator correct a wrong guess', async () => {
        const execute = mockImport();
        open();

        await selectFile('A,B,C\nAlex,Rivera,7');
        // Nothing resembles a name, so nothing is guessed.
        expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled();

        await userEvent.selectOptions(screen.getByLabelText('First Name'), 'A');
        await userEvent.selectOptions(screen.getByLabelText('Last Name'), 'B');
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(execute).toHaveBeenCalled());
        expect(execute.mock.calls[0][0].csvData).toBe('first_name,last_name\nAlex,Rivera');
    });

    it('warns about a row the backend would silently drop', async () => {
        mockImport(1);
        open();

        await selectFile('first,last\nAlex,Rivera\nSam,');

        expect(screen.getByText(/Line 3:/)).toBeInTheDocument();
        // A warning, not a blocker — the rest of the file is fine.
        expect(screen.getByRole('button', { name: /Import 2 Racers/ })).toBeEnabled();
    });

    it('says so when fewer racers arrived than rows were sent', async () => {
        mockImport(1);
        const onSuccess = vi.fn();
        open(onSuccess);

        await selectFile('first,last\nAlex,Rivera\nSam,');
        await userEvent.click(screen.getByRole('button', { name: /Import 2 Racers/ }));

        await waitFor(() =>
            expect(screen.getByText(/Imported 1 of 2 rows/)).toBeInTheDocument(),
        );
        expect(onSuccess).toHaveBeenCalled();
    });

    it('reports a file it cannot read', async () => {
        mockImport();
        open();

        const input = document.getElementById('csv-upload-input') as HTMLInputElement;
        await userEvent.upload(input, new File([''], 'empty.csv', { type: 'text/csv' }));

        await waitFor(() =>
            expect(screen.getByText('That file is empty.')).toBeInTheDocument(),
        );
        expect(screen.queryByText('Match your columns')).not.toBeInTheDocument();
    });

    it('surfaces a GraphQL error', async () => {
        const execute = vi.fn().mockResolvedValue({
            error: { graphQLErrors: [{ message: 'Race not found' }] },
        });
        (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{}, execute]);
        open();

        await selectFile('first,last\nAlex,Rivera');
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(screen.getByText('Race not found')).toBeInTheDocument());
    });

    // #1021: importing the same CSV a second time must refuse with the
    // server's own sentence, not a generic "could not be imported" — this
    // pins that `errorText` already surfaces `import_racers`'s ValueError
    // unwrapped, the same as every other GraphQL error this modal shows.
    it('surfaces the server refusal when a racer is already on the roster', async () => {
        const execute = vi.fn().mockResolvedValue({
            error: { graphQLErrors: [{ message: 'Alex Rivera is already on the roster.' }] },
        });
        (useMutation as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{}, execute]);
        open();

        await selectFile('first,last\nAlex,Rivera');
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() =>
            expect(screen.getByText('Alex Rivera is already on the roster.')).toBeInTheDocument(),
        );
    });

    // #768: nothing recorded that an import just succeeded, so the button
    // stayed enabled with the same rows behind it and a second click
    // resent the identical payload.
    it('will not resend the same rows after a successful import', async () => {
        const execute = mockImport(2);
        open();

        await selectFile('first,last\nAlex,Rivera\nSam,Okafor');
        await userEvent.click(screen.getByRole('button', { name: /Import 2 Racers/ }));

        await waitFor(() => expect(screen.getByText('Imported 2 racers.')).toBeInTheDocument());

        // The button that would resubmit the same rows must be gone, not
        // merely disabled behind the same label.
        expect(screen.queryByRole('button', { name: /Import 2 Racers/ })).not.toBeInTheDocument();
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('offers a way to import another file once one has succeeded', async () => {
        mockImport(1);
        open();

        await selectFile('first,last\nAlex,Rivera');
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(screen.getByText('Imported 1 racers.')).toBeInTheDocument());

        const again = screen.getByRole('button', { name: /Import Another File/ });
        await userEvent.click(again);

        // Back to the empty picker, not the stale mapping from the last file.
        expect(screen.getByText('Select CSV File')).toBeInTheDocument();
        expect(screen.queryByText('Match your columns')).not.toBeInTheDocument();
    });
});
