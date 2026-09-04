// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from 'urql';
import GprmImportModal from './GprmImportModal';
import { PREVIEW_GPRM_IMPORT } from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return { ...actual, useMutation: vi.fn() };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const PREVIEW_RESULT = {
    canImport: true,
    groups: [{ name: 'Wolves', division: null }],
    racers: [
        {
            firstName: 'Alex',
            lastName: 'Rivera',
            carNumber: 7,
            carName: 'Blue Streak',
            carWeight: null,
            passedInspection: true,
            group: 'Wolves',
            excludedFromStandings: false,
            sourceId: '1',
        },
    ],
    problems: [],
};

/**
 * `useMutation` is called twice by this component -- once for the preview
 * document, once for the confirm document -- and urql's document identity
 * is stable across imports, so the mock tells the two apart by which
 * document it was given, the same way the component itself never confuses
 * them.
 */
function mockGprmMutations({
    preview = vi.fn().mockResolvedValue({ data: { previewGprmImport: PREVIEW_RESULT } }),
    confirm = vi.fn().mockResolvedValue({ data: { confirmGprmImport: 1 } }),
    previewing = false,
} = {}) {
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation((doc: unknown) => {
        if (doc === PREVIEW_GPRM_IMPORT) return [{ fetching: previewing }, preview];
        return [{}, confirm];
    });
    return { preview, confirm };
}

async function selectFile(name = 'GPRM Data.sqlite') {
    const input = document.getElementById('gprm-upload-input') as HTMLInputElement;
    await userEvent.upload(input, new File(['sqlite bytes'], name));
}

const open = (onImportSuccess = vi.fn()) =>
    render(
        <GprmImportModal
            isOpen
            onClose={vi.fn()}
            raceId={1}
            onImportSuccess={onImportSuccess}
        />,
    );

describe('GprmImportModal', () => {
    it('previews a selected file without writing anything', async () => {
        const { preview, confirm } = mockGprmMutations();
        open();

        await selectFile();

        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
        expect(preview).toHaveBeenCalledWith({ raceId: 1, fileData: expect.stringContaining('base64,') });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('sends the same file data again on confirm', async () => {
        const { confirm } = mockGprmMutations();
        const onSuccess = vi.fn();
        open(onSuccess);

        await selectFile();
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(confirm).toHaveBeenCalled());
        expect(confirm.mock.calls[0][0].raceId).toBe(1);
        expect(confirm.mock.calls[0][0].fileData).toEqual(
            expect.stringContaining('base64,'),
        );
        await waitFor(() => expect(screen.getByText('Imported 1 racer.')).toBeInTheDocument());
        expect(onSuccess).toHaveBeenCalled();
    });

    it('shows the warnings a preview comes back with, without blocking import', async () => {
        mockGprmMutations({
            preview: vi.fn().mockResolvedValue({
                data: {
                    previewGprmImport: {
                        ...PREVIEW_RESULT,
                        problems: [
                            { message: 'Car number 7 is already used by Sam Okafor.', blocking: false, sourceId: '1' },
                        ],
                    },
                },
            }),
        });
        open();

        await selectFile();

        await waitFor(() =>
            expect(screen.getByText('Car number 7 is already used by Sam Okafor.')).toBeInTheDocument(),
        );
        expect(screen.getByRole('button', { name: /Import 1 Racer/ })).toBeEnabled();
    });

    it('reports a file the parser refuses, using its own sentence', async () => {
        mockGprmMutations({
            preview: vi.fn().mockResolvedValue({
                error: {
                    graphQLErrors: [
                        {
                            message:
                                'That file is not a GrandPrix Race Manager database. GPRM keeps its data as a single SQLite file.',
                        },
                    ],
                },
            }),
        });
        open();

        await selectFile('roster.csv');

        await waitFor(() =>
            expect(
                screen.getByText(/That file is not a GrandPrix Race Manager database/),
            ).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /Import/ })).toBeDisabled();
    });

    it('surfaces a GraphQL error from confirm', async () => {
        mockGprmMutations({
            confirm: vi.fn().mockResolvedValue({
                error: { graphQLErrors: [{ message: 'Race not found' }] },
            }),
        });
        open();

        await selectFile();
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(screen.getByText('Race not found')).toBeInTheDocument());
    });
});
