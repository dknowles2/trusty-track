import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useMutation } from 'urql';
import { IMPORT_RACERS } from '../graphql/queries';
import { errorText } from '../../../utils/errors';
import {
    applyMapping,
    canImport,
    FIELD_LABELS,
    FIELDS,
    guessMapping,
    parseCsv,
    templateCsv,
    toCanonicalCsv,
    validate,
    type Field,
    type Mapping,
    type ParsedCsv,
} from '../csvMapping';

interface ImportRacersModalProps {
    isOpen: boolean;
    onClose: () => void;
    raceId: number;
    onImportSuccess: () => void;
}

const PREVIEW_ROWS = 5;

/**
 * Import a roster from whatever CSV the pack already has.
 *
 * The operator picks a file, confirms which column feeds which field, sees the
 * first few rows as they would land, and imports. The reading, guessing and
 * checking are all in `../csvMapping.ts`; this file is the form around them.
 *
 * What gets sent is rebuilt from the mapping rather than forwarded from the
 * file, so the import is exactly what the preview showed.
 */
export default function ImportRacersModal({ isOpen, onClose, raceId, onImportSuccess }: ImportRacersModalProps) {
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParsedCsv | null>(null);
    const [mapping, setMapping] = useState<Mapping | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [, importRacersMutation] = useMutation(IMPORT_RACERS);

    const reset = () => {
        setFileName(null);
        setParsed(null);
        setMapping(null);
        setStatus(null);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (!selected) return;

        reset();
        setFileName(selected.name);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const file = parseCsv(event.target?.result as string);
                setParsed(file);
                setMapping(guessMapping(file.headers));
            } catch (error) {
                setStatus({
                    type: 'error',
                    message: errorText(error, 'That file could not be read.'),
                });
            }
        };
        reader.onerror = () => setStatus({ type: 'error', message: 'Failed to read that file.' });
        reader.readAsText(selected);
    };

    const setField = (field: Field, header: string) => {
        if (!mapping) return;
        setMapping({ ...mapping, [field]: header === '' ? null : header });
    };

    const rows = parsed && mapping ? applyMapping(parsed, mapping) : [];
    const problems = parsed && mapping ? validate(rows, mapping) : [];
    const ready = parsed !== null && mapping !== null && canImport(problems);
    const mappedFields = mapping ? FIELDS.filter((f) => mapping[f] !== null) : [];

    const handleImport = async () => {
        if (!parsed || !mapping) return;

        setUploading(true);
        setStatus(null);
        try {
            const result = await importRacersMutation({
                raceId,
                csvData: toCanonicalCsv(rows, mapping),
            });
            if (result.error) throw result.error;

            const imported = result.data.importRacers;
            setStatus({
                type: 'success',
                message:
                    imported === rows.length
                        ? `Imported ${imported} racers.`
                        : `Imported ${imported} of ${rows.length} rows; the rest were missing a name.`,
            });
            onImportSuccess();
        } catch (error: unknown) {
            setStatus({
                type: 'error',
                message: errorText(error, 'The racers could not be imported.'),
            });
        } finally {
            setUploading(false);
        }
    };

    const downloadTemplate = () => {
        const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'trusty-track-roster-template.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import Racers from CSV" maxWidth="720px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ color: '#666', lineHeight: '1.5', margin: 0 }}>
                    Any CSV will do — you match its columns to the fields we need once it is
                    loaded. If you are starting from scratch,{' '}
                    <button
                        type="button"
                        onClick={downloadTemplate}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--scouting-blue)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            font: 'inherit',
                        }}
                    >
                        download a template
                    </button>
                    .
                </p>

                <div style={{ border: '2px dashed #ccc', padding: '1.5rem', borderRadius: '8px', textAlign: 'center' }}>
                    <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                        id="csv-upload-input"
                    />
                    <label htmlFor="csv-upload-input" className="secondary-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                        {fileName ?? 'Select CSV File'}
                    </label>
                    {parsed && (
                        <p style={{ margin: '0.75rem 0 0', color: '#666', fontSize: '0.9rem' }}>
                            {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'},{' '}
                            {parsed.headers.length} columns
                        </p>
                    )}
                </div>

                {parsed && mapping && (
                    <>
                        <div>
                            <h4 style={{ margin: '0 0 0.5rem' }}>Match your columns</h4>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                                    gap: '0.75rem',
                                }}
                            >
                                {FIELDS.map((field) => (
                                    <label key={field} style={{ fontSize: '0.85rem', color: '#444' }}>
                                        {FIELD_LABELS[field]}
                                        {(field === 'firstName' || field === 'lastName') && (
                                            <span style={{ color: '#c62828' }}> *</span>
                                        )}
                                        <select
                                            aria-label={FIELD_LABELS[field]}
                                            value={mapping[field] ?? ''}
                                            onChange={(e) => setField(field, e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '8px',
                                                marginTop: '3px',
                                                borderRadius: '4px',
                                                border: '1px solid #ddd',
                                            }}
                                        >
                                            <option value="">Not included</option>
                                            {parsed.headers.map((header) => (
                                                <option key={header} value={header}>
                                                    {header}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 style={{ margin: '0 0 0.5rem' }}>
                                Preview
                                {rows.length > PREVIEW_ROWS && (
                                    <span style={{ fontWeight: 'normal', color: '#666', fontSize: '0.85rem' }}>
                                        {' '}
                                        — first {PREVIEW_ROWS} of {rows.length}
                                    </span>
                                )}
                            </h4>
                            <div style={{ overflowX: 'auto' }}>
                                <table className="racer-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            {mappedFields.map((field) => (
                                                <th key={field} style={{ textAlign: 'left', padding: '6px' }}>
                                                    {FIELD_LABELS[field]}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                                            <tr key={index}>
                                                {mappedFields.map((field) => (
                                                    <td key={field} style={{ padding: '6px' }}>
                                                        {row[field] || <span style={{ color: '#bbb' }}>—</span>}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {problems.length > 0 && (
                            <div
                                style={{
                                    padding: '10px',
                                    borderRadius: '4px',
                                    backgroundColor: ready ? '#fff8e1' : '#ffebee',
                                    color: ready ? '#8a6d00' : '#c62828',
                                    maxHeight: '160px',
                                    overflowY: 'auto',
                                }}
                            >
                                <p style={{ margin: 0, fontWeight: 'bold' }}>
                                    {ready
                                        ? `${problems.length} thing${problems.length === 1 ? '' : 's'} to check`
                                        : 'This file cannot be imported yet'}
                                </p>
                                <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
                                    {problems.map((problem, index) => (
                                        <li key={index}>
                                            {problem.line > 0 && <strong>Line {problem.line}: </strong>}
                                            {problem.message}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                {status && (
                    <div
                        style={{
                            padding: '10px',
                            borderRadius: '4px',
                            backgroundColor: status.type === 'success' ? '#e8f5e9' : '#ffebee',
                            color: status.type === 'success' ? '#2e7d32' : '#c62828',
                        }}
                    >
                        <p style={{ margin: 0, fontWeight: 'bold' }}>{status.message}</p>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.5rem' }}>
                    <button onClick={handleClose} className="secondary-btn" disabled={uploading}>
                        Close
                    </button>
                    <button onClick={handleImport} className="primary-btn" disabled={!ready || uploading}>
                        {uploading ? 'Importing...' : rows.length ? `Import ${rows.length} Racers` : 'Import Racers'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
