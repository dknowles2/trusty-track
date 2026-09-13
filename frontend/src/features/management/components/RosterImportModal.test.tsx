// @vitest-environment jsdom
import '../../../setupTests';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from 'urql';
import RosterImportModal, { IMPORT_OTHER_SOFTWARE_LABEL, RosterImportSource } from './RosterImportModal';
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

/** No `source` -- the modal opens on its own chooser step. */
const openChooser = (onImportSuccess = vi.fn()) =>
    render(
        <RosterImportModal
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

    it('blocks import and reddens the banner when a racer already on the roster is named (#1021)', async () => {
        mockMutations(source, {
            preview: vi.fn().mockResolvedValue({
                data: {
                    [SOURCES[source].previewField]: {
                        ...PREVIEW_RESULT,
                        canImport: false,
                        problems: [
                            { message: 'Alex Rivera is already on the roster.', blocking: true, sourceId: '1' },
                        ],
                    },
                },
            }),
        });
        open(source);

        await selectFile(source, 'roster.sqlite');

        await waitFor(() =>
            expect(screen.getByText('Alex Rivera is already on the roster.')).toBeInTheDocument(),
        );
        expect(screen.getByText('This file cannot be imported yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Import 1 Racer/ })).toBeDisabled();
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

    // #768: the same file data stays in state after a successful confirm,
    // so a second click used to send an identical confirm a second time.
    it('will not resend the same file after a successful import', async () => {
        const { confirm } = mockMutations(source);
        open(source);

        await selectFile(source, 'roster.sqlite');
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: /Import 1 Racer/ }));

        await waitFor(() => expect(screen.getByText('Imported 1 racer.')).toBeInTheDocument());

        expect(screen.queryByRole('button', { name: /Import 1 Racer/ })).not.toBeInTheDocument();
        expect(confirm).toHaveBeenCalledTimes(1);
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

// #1086: one menu entry opens this modal with no `source`, and it asks
// which program on its own chooser step rather than the roster offering
// two near-identical menu entries with the same icon.
describe('RosterImportModal (chooser)', () => {
    it('renders one option per source, and nothing further, when no source is pinned', () => {
        mockMutations('gprm');
        openChooser();

        expect(screen.getByRole('heading')).toHaveTextContent(IMPORT_OTHER_SOFTWARE_LABEL);
        // One radio per `SOURCE_CONFIG` key -- adding a third source should
        // mean adding a config entry, not touching this chooser's JSX.
        expect(screen.getAllByRole('radio')).toHaveLength(2);
        expect(screen.getByText('GrandPrix Race Manager')).toBeInTheDocument();
        expect(screen.getByText('DerbyNet')).toBeInTheDocument();
        // Nothing from the file step has appeared yet.
        expect(screen.queryByRole('button', { name: /Select .* Database/ })).not.toBeInTheDocument();
    });

    it('disables Continue until a source is picked', () => {
        mockMutations('gprm');
        openChooser();

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('continues to the file step for the picked source', async () => {
        mockMutations('derbynet');
        openChooser();

        await userEvent.click(screen.getByRole('radio', { name: /DerbyNet/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByRole('heading')).toHaveTextContent('DerbyNet');
        expect(screen.getByText('Select DerbyNet Database')).toBeInTheDocument();

        await selectFile('derbynet', 'roster.sqlite');
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    });

    it('Back clears the file and returns to the chooser', async () => {
        mockMutations('derbynet');
        openChooser();

        await userEvent.click(screen.getByRole('radio', { name: /DerbyNet/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await selectFile('derbynet', 'roster.sqlite');
        await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByRole('heading')).toHaveTextContent(IMPORT_OTHER_SOFTWARE_LABEL);

        // Continuing again on the same source shows an empty file step --
        // the file picked before Back is gone, not carried over.
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByText('Select DerbyNet Database')).toBeInTheDocument();
        expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    });

    // The reviewer on #1086 flagged this as a follow-up, not a blocker: the
    // component instance now persists across a source switch (it used to be
    // a fresh mount per source), so `runPreview`'s async completion needs
    // its own guard against a stale response landing under the wrong
    // program's file step.
    it('does not show a stale preview after backing out mid-preview and switching source', async () => {
        let resolveGprmPreview!: (value: { data: Record<string, unknown> }) => void;
        const gprmPreviewPromise = new Promise<{ data: Record<string, unknown> }>((resolve) => {
            resolveGprmPreview = resolve;
        });
        const gprmPreview = vi.fn().mockReturnValue(gprmPreviewPromise);
        const derbynetPreview = vi.fn().mockResolvedValue({
            data: { previewDerbynetImport: PREVIEW_RESULT },
        });
        (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation((doc: unknown) => {
            if (doc === PREVIEW_GPRM_IMPORT) return [{ fetching: false }, gprmPreview];
            if (doc === PREVIEW_DERBYNET_IMPORT) return [{ fetching: false }, derbynetPreview];
            return [{}, vi.fn()];
        });

        openChooser();

        // Start a GPRM preview and leave it unresolved.
        await userEvent.click(screen.getByRole('radio', { name: /GrandPrix Race Manager/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await selectFile('gprm', 'roster.sqlite');
        expect(gprmPreview).toHaveBeenCalled();

        // Back out, without waiting for that preview, and switch to DerbyNet.
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        await userEvent.click(screen.getByRole('radio', { name: /DerbyNet/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByText('Select DerbyNet Database')).toBeInTheDocument();

        // The abandoned GPRM preview settles only now. Flushed inside
        // `act()` so its `.then` genuinely runs (and its `setPreview` would
        // genuinely land) before the assertion below -- otherwise this test
        // passes for the wrong reason, whether or not the guard exists.
        await act(async () => {
            resolveGprmPreview({ data: { previewGprmImport: PREVIEW_RESULT } });
            await gprmPreviewPromise;
        });

        // Still on DerbyNet's own, file-less step -- the stale GPRM result
        // must not have populated `preview`.
        expect(screen.getByText('Select DerbyNet Database')).toBeInTheDocument();
        expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    });

    it('skips the chooser when a source is pinned', () => {
        mockMutations('gprm');
        open('gprm');

        expect(screen.getByRole('heading')).toHaveTextContent('GrandPrix Race Manager');
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        // No chooser to go back to.
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    });
});
