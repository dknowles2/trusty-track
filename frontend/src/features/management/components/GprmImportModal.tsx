import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useMutation } from 'urql';
import { PREVIEW_GPRM_IMPORT, CONFIRM_GPRM_IMPORT } from '../graphql/queries';
import { errorText } from '../../../utils/errors';
import { useTerminology } from '../../../context/TerminologyContext';
import type { PreviewGprmImportMutation } from '../../../gql/operations';

interface GprmImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    raceId: number;
    onImportSuccess: () => void;
}

type Preview = PreviewGprmImportMutation['previewGprmImport'];

const PREVIEW_ROWS = 5;

/**
 * Import a roster from a GrandPrix Race Manager database (#618).
 *
 * Unlike the CSV importer there is no column mapping here — the file is a
 * database, not a spreadsheet, and the mapping from GPRM's tables to a
 * roster already happened server-side in `domain/gprm.py`. So the flow is
 * shorter: pick a file, the server previews what it found without writing
 * anything, and a second click writes it. Both calls send the same file
 * data — there is no session on the server holding the upload in between,
 * so what gets written can never drift from what the preview showed.
 */
export default function GprmImportModal({ isOpen, onClose, raceId, onImportSuccess }: GprmImportModalProps) {
    const { group, vehicle, groupLower, groupsLower } = useTerminology();
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileData, setFileData] = useState<string | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [previewResult, previewMutation] = useMutation(PREVIEW_GPRM_IMPORT);
    const [, confirmMutation] = useMutation(CONFIRM_GPRM_IMPORT);

    const reset = () => {
        setFileName(null);
        setFileData(null);
        setPreview(null);
        setStatus(null);
    };

    const runPreview = async (dataUrl: string) => {
        setStatus(null);
        setPreview(null);
        try {
            const result = await previewMutation({ raceId, fileData: dataUrl });
            if (result.error) throw result.error;
            setPreview(result.data?.previewGprmImport ?? null);
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
        if (!fileData || !preview) return;

        setConfirming(true);
        setStatus(null);
        try {
            const result = await confirmMutation({ raceId, fileData });
            if (result.error) throw result.error;

            const imported = result.data?.confirmGprmImport ?? 0;
            setStatus({
                type: 'success',
                message: `Imported ${imported} racer${imported === 1 ? '' : 's'}.`,
            });
            onImportSuccess();
        } catch (error: unknown) {
            setStatus({
                type: 'error',
                message: errorText(error, 'The roster could not be imported.'),
            });
        } finally {
            setConfirming(false);
        }
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    if (!isOpen) return null;

    const previewing = previewResult.fetching;
    const ready = preview !== null && preview.canImport && !previewing;

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import from GrandPrix Race Manager" maxWidth="720px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ color: 'var(--text-muted-color)', lineHeight: '1.5', margin: 0 }}>
                    GrandPrix Race Manager (version 18 or later) keeps its data as a single
                    SQLite file, usually under Documents &gt; Lisano Enterprises &gt; GrandPrix
                    Race Manager &gt; Data. Select it below and check the preview before
                    importing — the mapping from its tables to a roster here is inferred from
                    its schema, not confirmed against a real GPRM install, so it is worth a
                    second look rather than assumed correct.
                </p>

                <div style={{ border: '2px dashed var(--input-border-color)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center' }}>
                    <input
                        type="file"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                        id="gprm-upload-input"
                    />
                    <label htmlFor="gprm-upload-input" className="secondary-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                        {fileName ?? 'Select GPRM Database'}
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

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.5rem' }}>
                    <button onClick={handleClose} className="secondary-btn" disabled={confirming}>
                        Close
                    </button>
                    <button onClick={handleImport} className="primary-btn" disabled={!ready || confirming}>
                        {confirming
                            ? 'Importing...'
                            : preview
                              ? `Import ${preview.racers.length} Racer${preview.racers.length === 1 ? '' : 's'}`
                              : 'Import'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
