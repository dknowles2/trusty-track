import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Modal from '../../../components/ui/Modal';
import { useMutation } from 'urql';
import type { TypedDocumentNode } from 'urql';
import {
    PREVIEW_GPRM_IMPORT,
    CONFIRM_GPRM_IMPORT,
    PREVIEW_DERBYNET_IMPORT,
    CONFIRM_DERBYNET_IMPORT,
} from '../graphql/queries';
import { errorText } from '../../../utils/errors';
import { useTerminology } from '../../../context/TerminologyContext';

export type RosterImportSource = 'gprm' | 'derbynet';

interface RosterImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    raceId: number;
    onImportSuccess: () => void;
    // Optional: when passed, the source chooser below is skipped entirely
    // (a deep link, or a test that only cares about one source's own
    // behaviour). Left unset, the modal opens on the chooser step and
    // `source` is decided by which option the operator picks.
    source?: RosterImportSource;
}

/** The menu label, and the chooser step's own title — chosen so the menu
 * lists one entry for "not CSV, not this app's own format" rather than
 * naming both programs (and growing a third label whenever a third program
 * is added — see the chooser below, which is built the same way). */
export const IMPORT_OTHER_SOFTWARE_LABEL = 'Import from other racing software';

/**
 * The shape both `previewGprmImport` and `previewDerbynetImport` return —
 * codegen gives each its own operation type, but the two are structurally
 * identical (both are `domain.roster_import.ParsedRoster`, read through
 * either program's own parser), which is exactly why one modal can read
 * either result through one type rather than a union.
 */
interface RosterImportPreview {
    canImport: boolean;
    groups: Array<{ name: string; division: string | null }>;
    racers: Array<{
        firstName: string;
        lastName: string;
        carNumber: number | null;
        carName: string | null;
        carWeight: number | null;
        passedInspection: boolean;
        group: string | null;
        excludedFromStandings: boolean;
        sourceId: string | null;
    }>;
    problems: Array<{ message: string; blocking: boolean; sourceId: string | null }>;
}

interface SourceConfig {
    title: string;
    // The chooser step's own one-liner for this program — where its file
    // usually lives, short enough to sit under a radio option. `help` below
    // is the longer version, kept for the file step, where there is room
    // for it and a reason to read it (the file picker is right there).
    programName: string;
    fileLocationHint: ReactNode;
    help: ReactNode;
    fileInputId: string;
    fileButtonLabel: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- urql's mutation doc type varies per operation; the field this modal reads is picked below by name, not by the doc's own generated shape.
    previewDoc: TypedDocumentNode<any, { raceId: number; fileData: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    confirmDoc: TypedDocumentNode<any, { raceId: number; fileData: string }>;
    previewField: string;
    confirmField: string;
}

/**
 * Import a roster from another derby program's database — GrandPrix Race
 * Manager (#618) or DerbyNet (#661). Both write the same table family
 * (`RegistrationInfo`/`Classes`/`Ranks` — see `domain/gprm.py`'s and
 * `domain/derbynet.py`'s own docstrings), and both preview-then-confirm
 * mutations share this exact shape, so one modal reads a `source` prop
 * rather than each program growing its own copy of this screen.
 *
 * Unlike the CSV importer there is no column mapping here — the file is a
 * database, not a spreadsheet, and the mapping already happened
 * server-side. So the flow is shorter: pick a file, the server previews
 * what it found without writing anything, and a second click writes it.
 * Both calls send the same file data — there is no session on the server
 * holding the upload in between, so what gets written can never drift from
 * what the preview showed.
 */
const SOURCE_CONFIG: Record<RosterImportSource, SourceConfig> = {
    gprm: {
        title: 'Import from GrandPrix Race Manager',
        programName: 'GrandPrix Race Manager',
        fileLocationHint: (
            <>
                A single SQLite file, usually under Documents &gt; Lisano Enterprises &gt;
                GrandPrix Race Manager &gt; Data.
            </>
        ),
        help: (
            <>
                GrandPrix Race Manager (version 18 or later) keeps its data as a single
                SQLite file, usually under Documents &gt; Lisano Enterprises &gt; GrandPrix
                Race Manager &gt; Data. Select it below and check the preview before
                importing — the mapping from its tables to a roster here is inferred from
                its schema, not confirmed against a real GPRM install, so it is worth a
                second look rather than assumed correct.
            </>
        ),
        fileInputId: 'gprm-upload-input',
        fileButtonLabel: 'Select GPRM Database',
        previewDoc: PREVIEW_GPRM_IMPORT,
        confirmDoc: CONFIRM_GPRM_IMPORT,
        previewField: 'previewGprmImport',
        confirmField: 'confirmGprmImport',
    },
    derbynet: {
        title: 'Import from DerbyNet',
        programName: 'DerbyNet',
        fileLocationHint: (
            <>
                A single SQLite file — from its Administer Race page&apos;s Backup Database
                link, or the file in its own data directory.
            </>
        ),
        help: (
            <>
                DerbyNet keeps its data as a single SQLite file — from its Administer
                Race page&apos;s Backup Database link, or the file in its own data
                directory. Select it below and check the preview before importing — the
                mapping from its tables to a roster here is inferred from its schema, not
                confirmed against a real DerbyNet install, so it is worth a second look
                rather than assumed correct.
            </>
        ),
        fileInputId: 'derbynet-upload-input',
        fileButtonLabel: 'Select DerbyNet Database',
        previewDoc: PREVIEW_DERBYNET_IMPORT,
        confirmDoc: CONFIRM_DERBYNET_IMPORT,
        previewField: 'previewDerbynetImport',
        confirmField: 'confirmDerbynetImport',
    },
};

const PREVIEW_ROWS = 5;

const SOURCE_KEYS = Object.keys(SOURCE_CONFIG) as RosterImportSource[];

export default function RosterImportModal({ isOpen, onClose, raceId, onImportSuccess, source }: RosterImportModalProps) {
    // `pickedSource` is null exactly while the chooser step is showing. When
    // `source` is passed, it is never null and the chooser never renders.
    const [pickedSource, setPickedSource] = useState<RosterImportSource | null>(source ?? null);
    // The radio selection on the chooser step, kept separate from
    // `pickedSource` so "Continue" is a deliberate second click rather than
    // picking an option jumping straight to the file step.
    const [chooserSelection, setChooserSelection] = useState<RosterImportSource | null>(null);
    const choosing = pickedSource === null;
    // A config is needed unconditionally below so every hook this component
    // calls sees a stable argument shape on the chooser step too — nothing
    // here fires a network request until a file is actually chosen, so
    // which entry stands in while `choosing` is true does not matter.
    const config = SOURCE_CONFIG[pickedSource ?? SOURCE_KEYS[0]];
    const { group, vehicle, groupLower, groupsLower } = useTerminology();
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileData, setFileData] = useState<string | null>(null);
    const [preview, setPreview] = useState<RosterImportPreview | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    // Set once a file has been confirmed, so the same file data cannot be
    // sent a second time (#768) — `reset()`, which choosing a new file
    // already calls, clears it.
    const [imported, setImported] = useState(false);
    const [previewResult, previewMutation] = useMutation(config.previewDoc);
    const [, confirmMutation] = useMutation(config.confirmDoc);
    // A synchronous re-entrancy guard alongside `confirming`'s own disabled
    // state, the same shape `Home.tsx`'s practice-race button uses (#588):
    // urql's fetching flag only lands once a render has caught up, and two
    // clicks in the same tick can both fire before that happens.
    const confirmingRef = useRef(false);

    const reset = () => {
        setFileName(null);
        setFileData(null);
        setPreview(null);
        setStatus(null);
        setImported(false);
    };

    const runPreview = async (dataUrl: string) => {
        setStatus(null);
        setPreview(null);
        try {
            const result = await previewMutation({ raceId, fileData: dataUrl });
            if (result.error) throw result.error;
            const data = result.data as Record<string, RosterImportPreview> | null | undefined;
            setPreview(data?.[config.previewField] ?? null);
        } catch (error: unknown) {
            setStatus({
                type: 'error',
                message: errorText(error, 'That file could not be read.'),
            });
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (!selected) return;

        reset();
        setFileName(selected.name);

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            setFileData(dataUrl);
            void runPreview(dataUrl);
        };
        reader.onerror = () => setStatus({ type: 'error', message: 'Failed to read that file.' });
        reader.readAsDataURL(selected);
    };

    const handleImport = async () => {
        if (!fileData || !preview || confirmingRef.current) return;

        confirmingRef.current = true;
        setConfirming(true);
        setStatus(null);
        try {
            const result = await confirmMutation({ raceId, fileData });
            if (result.error) throw result.error;

            const data = result.data as Record<string, number> | null | undefined;
            const importedCount = data?.[config.confirmField] ?? 0;
            setStatus({
                type: 'success',
                message: `Imported ${importedCount} racer${importedCount === 1 ? '' : 's'}.`,
            });
            // The file data just sent must not still be sitting behind an
            // enabled Import button (#768) — clearing it also drops `ready`
            // to false, and the action row swaps to "Import Another File"
            // once `imported` is set.
            setFileData(null);
            setPreview(null);
            setImported(true);
            onImportSuccess();
        } catch (error: unknown) {
            setStatus({
                type: 'error',
                message: errorText(error, 'The roster could not be imported.'),
            });
        } finally {
            setConfirming(false);
            confirmingRef.current = false;
        }
    };

    const handleClose = () => {
        reset();
        // Closing without a fixed `source` prop goes back to a fresh
        // chooser next time this modal opens, rather than reopening on
        // whatever program was picked last time.
        if (!source) {
            setPickedSource(null);
            setChooserSelection(null);
        }
        onClose();
    };

    // Returning to the chooser clears the file the same way choosing a new
    // one already does (`reset`) — the file just picked belonged to the
    // program being left, and carrying it over to a different program's
    // preview mutation would send a database to the wrong parser.
    const handleBack = () => {
        reset();
        setChooserSelection(pickedSource);
        setPickedSource(null);
    };

    const handleContinue = () => {
        if (chooserSelection) setPickedSource(chooserSelection);
    };

    if (!isOpen) return null;

    if (choosing) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} title={IMPORT_OTHER_SOFTWARE_LABEL} maxWidth="720px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ color: 'var(--text-muted-color)', lineHeight: '1.5', margin: 0 }}>
                        Which program is the roster coming from?
                    </p>
                    {SOURCE_KEYS.map((key) => {
                        const cfg = SOURCE_CONFIG[key];
                        return (
                            <label
                                key={key}
                                style={{
                                    display: 'flex',
                                    gap: '10px',
                                    alignItems: 'flex-start',
                                    padding: '10px',
                                    border: '1px solid var(--input-border-color)',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="radio"
                                    name="roster-import-source"
                                    value={key}
                                    checked={chooserSelection === key}
                                    onChange={() => setChooserSelection(key)}
                                    style={{ marginTop: '3px' }}
                                />
                                <span>
                                    <strong>{cfg.programName}</strong>
                                    <br />
                                    <span style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem' }}>
                                        {cfg.fileLocationHint}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.5rem' }}>
                        <button onClick={handleClose} className="secondary-btn">
                            Close
                        </button>
                        <button onClick={handleContinue} className="primary-btn" disabled={!chooserSelection}>
                            Continue
                        </button>
                    </div>
                </div>
            </Modal>
        );
    }

    const previewing = previewResult.fetching;
    const ready = preview !== null && preview.canImport && !previewing;

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={config.title} maxWidth="720px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ color: 'var(--text-muted-color)', lineHeight: '1.5', margin: 0 }}>
                    {config.help}
                </p>

                <div style={{ border: '2px dashed var(--input-border-color)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center' }}>
                    <input
                        type="file"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                        id={config.fileInputId}
                    />
                    <label htmlFor={config.fileInputId} className="secondary-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                        {fileName ?? config.fileButtonLabel}
                    </label>
                    {previewing && (
                        <p style={{ margin: '0.75rem 0 0', color: 'var(--text-muted-color)', fontSize: '0.9rem' }}>
                            Reading file…
                        </p>
                    )}
                    {preview && (
                        <p style={{ margin: '0.75rem 0 0', color: 'var(--text-muted-color)', fontSize: '0.9rem' }}>
                            {preview.racers.length} {preview.racers.length === 1 ? 'racer' : 'racers'},{' '}
                            {preview.groups.length} {preview.groups.length === 1 ? groupLower : groupsLower}
                        </p>
                    )}
                </div>

                {preview && preview.racers.length > 0 && (
                    <div>
                        <h4 style={{ margin: '0 0 0.5rem' }}>
                            Preview
                            {preview.racers.length > PREVIEW_ROWS && (
                                <span style={{ fontWeight: 'normal', color: 'var(--text-muted-color)', fontSize: '0.85rem' }}>
                                    {' '}
                                    — first {PREVIEW_ROWS} of {preview.racers.length}
                                </span>
                            )}
                        </h4>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="racer-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '6px' }}>Name</th>
                                        <th style={{ textAlign: 'left', padding: '6px' }}>{vehicle} #</th>
                                        <th style={{ textAlign: 'left', padding: '6px' }}>{vehicle} Name</th>
                                        <th style={{ textAlign: 'left', padding: '6px' }}>{group}</th>
                                        <th style={{ textAlign: 'left', padding: '6px' }}>Passed Inspection</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.racers.slice(0, PREVIEW_ROWS).map((racer, index) => (
                                        <tr key={index}>
                                            <td style={{ padding: '6px' }}>{racer.firstName} {racer.lastName}</td>
                                            <td style={{ padding: '6px' }}>
                                                {racer.carNumber ?? <span style={{ color: 'var(--text-placeholder-color)' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '6px' }}>
                                                {racer.carName || <span style={{ color: 'var(--text-placeholder-color)' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '6px' }}>
                                                {racer.group || <span style={{ color: 'var(--text-placeholder-color)' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '6px' }}>{racer.passedInspection ? 'Yes' : 'No'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {preview && preview.problems.length > 0 && (
                    <div
                        style={{
                            padding: '10px',
                            borderRadius: '4px',
                            backgroundColor: preview.canImport ? 'var(--warning-bg-color)' : 'var(--danger-bg-color)',
                            color: preview.canImport ? 'var(--warning-color)' : 'var(--danger-strong-color)',
                            maxHeight: '160px',
                            overflowY: 'auto',
                        }}
                    >
                        <p style={{ margin: 0, fontWeight: 'bold' }}>
                            {preview.canImport
                                ? `${preview.problems.length} thing${preview.problems.length === 1 ? '' : 's'} to check`
                                : 'This file cannot be imported yet'}
                        </p>
                        <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
                            {preview.problems.map((problem, index) => (
                                <li key={index}>{problem.message}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {status && (
                    <div
                        style={{
                            padding: '10px',
                            borderRadius: '4px',
                            backgroundColor: status.type === 'success' ? 'var(--success-bg-color)' : 'var(--danger-bg-color)',
                            color: status.type === 'success' ? 'var(--success-color)' : 'var(--danger-strong-color)',
                        }}
                    >
                        <p style={{ margin: 0, fontWeight: 'bold' }}>{status.message}</p>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '0.5rem' }}>
                    {/* Only reachable through the chooser -- a caller that
                        pinned `source` skipped it, so there is nowhere for
                        Back to return to. */}
                    {!source ? (
                        <button onClick={handleBack} className="secondary-btn" disabled={confirming}>
                            Back
                        </button>
                    ) : (
                        <span />
                    )}
                    <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={handleClose} className="secondary-btn" disabled={confirming}>
                        Close
                    </button>
                    {imported ? (
                        // #768: once a file has been confirmed, there is
                        // nothing left for a click on this row to resend —
                        // starting over is a deliberate act of its own, back
                        // at the empty picker.
                        <button onClick={reset} className="primary-btn">
                            Import Another File
                        </button>
                    ) : (
                        <button onClick={handleImport} className="primary-btn" disabled={!ready || confirming}>
                            {confirming
                                ? 'Importing...'
                                : preview
                                  ? `Import ${preview.racers.length} Racer${preview.racers.length === 1 ? '' : 's'}`
                                  : 'Import'}
                        </button>
                    )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
