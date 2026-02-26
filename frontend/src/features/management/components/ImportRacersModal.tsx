import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useMutation } from 'urql';
import { IMPORT_RACERS } from '../graphql/queries';

interface ImportRacersModalProps {
    isOpen: boolean;
    onClose: () => void;
    raceId: number;
    onImportSuccess: () => void;
}

export default function ImportRacersModal({ isOpen, onClose, raceId, onImportSuccess }: ImportRacersModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string, errors?: string[] } | null>(null);
    const [, importRacersMutation] = useMutation(IMPORT_RACERS);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setStatus({ type: 'error', message: "Please select a file first." });
            return;
        }

        setUploading(true);
        setStatus(null);

        const reader = new FileReader();

        reader.onload = async (e) => {
            const csvData = e.target?.result as string;
            
            try {
                const result = await importRacersMutation({ raceId, csvData });
                
                if (result.error) {
                    throw result.error;
                }

                const importedCount = result.data.importRacers;
                setStatus({ type: 'success', message: `Successfully imported ${importedCount} racers.` });
                onImportSuccess();

            } catch (error: unknown) {
                console.error("Import failed", error);
                
                let message = "Failed to import racers. Please try again.";
                const err = error as { graphQLErrors?: { message: string }[], message?: string };
                if (err.graphQLErrors && err.graphQLErrors.length > 0) {
                    message = err.graphQLErrors[0].message;
                } else if (err.message) {
                    message = err.message;
                }
                
                setStatus({ 
                    type: 'error', 
                    message: message
                });
            } finally {
                setUploading(false);
            }
        };

        reader.onerror = () => {
            setStatus({ type: 'error', message: "Failed to read file." });
            setUploading(false);
        };

        reader.readAsText(file);
    };

    const handleClose = () => {
        setFile(null);
        setStatus(null);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="Import Racers from CSV"
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ color: '#666', lineHeight: '1.5' }}>
                    Upload a CSV file with the following headers: 
                    <code>First Name, Last Name, Car Number, Den</code>.
                </p>

                <div style={{ border: '2px dashed #ccc', padding: '2rem', borderRadius: '8px', textAlign: 'center' }}>
                    <input 
                        type="file" 
                        accept=".csv" 
                        onChange={handleFileChange} 
                        style={{ display: 'none' }} 
                        id="csv-upload-input"
                    />
                    <label htmlFor="csv-upload-input" className="secondary-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                        {file ? file.name : "Select CSV File"}
                    </label>
                </div>

                {status && (
                    <div style={{ 
                        padding: '10px', 
                        borderRadius: '4px', 
                        backgroundColor: status.type === 'success' ? '#e8f5e9' : '#ffebee',
                        color: status.type === 'success' ? '#2e7d32' : '#c62828'
                    }}>
                        <p style={{ margin: 0, fontWeight: 'bold' }}>{status.message}</p>
                        {status.errors && status.errors.length > 0 && (
                            <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
                                {status.errors.map((err, idx) => (
                                    <li key={idx}>{err}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1rem' }}>
                    <button 
                        onClick={handleClose} 
                        className="secondary-btn"
                        disabled={uploading}
                    >
                        Close
                    </button>
                    <button 
                        onClick={handleUpload} 
                        className="primary-btn" 
                        disabled={!file || uploading}
                    >
                        {uploading ? 'Importing...' : 'Import Racers'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
