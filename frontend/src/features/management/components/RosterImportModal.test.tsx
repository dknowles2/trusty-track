// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from 'urql';
import RosterImportModal, { RosterImportSource } from './RosterImportModal';
import {
    PREVIEW_GPRM_IMPORT,
    PREVIEW_DERBYNET_IMPORT,
} from '../graphql/queries';

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
 * The two sources share every behaviour below `RosterImportModal` itself,
 * so the whole suite runs once per source rather than being duplicated --
 * the same reasoning the component itself is built on. Each entry names the
 * document its own preview mutation is called with (urql's document
 * identity is stable across imports, which is how the mock in
 * `mockMutations` tells preview and confirm apart), the field name its
 * mutations reply under, the upload input's id, and the file-not-recognised
 * sentence its own parser would actually send.
 */
const SOURCES: Record<
    RosterImportSource,
    {
        previewDoc: typeof PREVIEW_GPRM_IMPORT;
        previewField: string;
        confirmField: string;
        fileInputId: string;
        refusalMessage: string;
        titleFragment: string;
    }
> = {
    gprm: {
        previewDoc: PREVIEW_GPRM_IMPORT,
        previewField: 'previewGprmImport',
        confirmField: 'confirmGprmImport',
        fileInputId: 'gprm-upload-input',
        refusalMessage:
            'That file is not a GrandPrix Race Manager database. GPRM keeps its data as a single SQLite file.',
        titleFragment: 'GrandPrix Race Manager',
    },
    derbynet: {
        previewDoc: PREVIEW_DERBYNET_IMPORT,
        previewField: 'previewDerbynetImport',
        confirmField: 'confirmDerbynetImport',
        fileInputId: 'derbynet-upload-input',
        refusalMessage: 'That file is not a DerbyNet database.',
        titleFragment: 'DerbyNet',
    },
};

function mockMutations(
    source: RosterImportSource,
    {
        preview = vi.fn().mockResolvedValue({
            data: { [SOURCES[source].previewField]: PREVIEW_RESULT },
        }),
        confirm = vi.fn().mockResolvedValue({
            data: { [SOURCES[source].confirmField]: 1 },
        }),
        previewing = false,
    } = {},
) {
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation((doc: unknown) => {
        if (doc === SOURCES[source].previewDoc) return [{ fetching: previewing }, preview];
        return [{}, confirm];
    });
    return { preview, confirm };
}

async function selectFile(source: RosterImportSource, name: string) {
    const input = document.getElementById(SOURCES[source].fileInputId) as HTMLInputElement;
    await userEvent.upload(input, new File(['sqlite bytes'], name));
}

const open = (source: RosterImportSource, onImportSuccess = vi.fn()) =>
    render(
        <RosterImportModal
            source={source}
            isOpen
            onClose={vi.fn()}
            raceId={1}
            onImportSuccess={onImportSuccess}
        />,
    );

describe.each(Object.keys(SOURCES) as RosterImportSource[])('RosterImportModal (%s)', (source) => {
    const { refusalMessage } = SOURCES[source];

    it('previews a selected file without writing anything', async () => {
        const { preview, confirm } = mockMutations(source);
        open(source);

        await selectFile(source, 'roster.sqlite');

        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
        expect(preview).toHaveBeenCalledWith({ raceId: 1, fileData: expect.stringContaining('base64,') });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('sends the same file data again on confirm', async () => {
        const { confirm } = mockMutations(source);
        const onSuccess = vi.fn();
        open(source, onSuccess);

        await selectFile(source, 'roster.sqlite');
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
        mockMutations(source, {
            preview: vi.fn().mockResolvedValue({
                data: {
                    [SOURCES[source].previewField]: {
                        ...PREVIEW_RESULT,
                        problems: [
                            { message: 'Car number 7 is already used by Sam Okafor.', blocking: false, sourceId: '1' },
                        ],
                    },
                },
            }),
        });
        open(source);

        await selectFile(source, 'roster.sqlite');

        await waitFor(() =>
            expect(screen.getByText('Car number 7 is already used by Sam Okafor.')).toBeInTheDocument(),
        );
        expect(screen.getByRole('button', { name: /Import 1 Racer/ })).toBeEnabled();
    });

    it('reports a file the parser refuses, using its own sentence', async () => {
        mockMutations(source, {
            preview: vi.fn().mockResolvedValue({
                error: { graphQLErrors: [{ message: refusalMessage }] },
            }),
        });
        open(source);

        await selectFile(source, 'roster.csv');

        await waitFor(() =>
            expect(screen.getByText(new RegExp(refusalMessage.split('.')[0]))).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /Import/ })).toBeDisabled();
    });

    it('surfaces a GraphQL error from confirm', async () => {
        mockMutations(source, {
            confirm: vi.fn().mockResolvedValue({
                error: { graphQLErrors: [{ message: 'Race not found' }] },
            }),
        });
        open(source);

        await selectFile(source, 'roster.sqlite');
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(screen.getByText('Race not found')).toBeInTheDocument());
    });

    it('names the right program in its title', async () => {
        mockMutations(source);
        open(source);
        // `getByRole('heading')` rather than `getByText` -- the help
        // paragraph names the same program too, so a plain text match would
        // find both and throw on the ambiguity.
        expect(screen.getByRole('heading')).toHaveTextContent(SOURCES[source].titleFragment);
    });
});
