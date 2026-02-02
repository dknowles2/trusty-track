import { useState, useRef } from 'react';
import { apiClient } from '../api/client';
import Modal from './Modal';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
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

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await apiClient.post(`/races/${raceId}/import-racers`, formData);
            
            // Axios response.data might be the object returned from backend
            const result = response; 

            if (result.errors && result.errors.length > 0) {
                 setStatus({ 
                    type: 'success', // Partial success is still success-ish but with warnings
                    message: result.message,
                    errors: result.errors
                });
            } else {
                 setStatus({ type: 'success', message: result.message });
                 onImportSuccess();
                 // Close after a brief delay if perfect success? Or let user close.
                 // let's let user see the outcome.
            }

        } catch (e: any) {
            console.error("Upload failed", e);
            setStatus({ 
                type: 'error', 
                message: e.response?.data?.detail || "Failed to upload file. Please try again." 
            });
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setStatus(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import Racers from CSV">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ backgroundColor: '#f0f7ff', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', color: '#003F87' }}>
                    <p style={{ marginTop: 0, fontWeight: 'bold' }}>Instructions:</p>
                    <p style={{ marginBottom: '0.5rem' }}>Upload a CSV file with the following headers:</p>
                    <code style={{ background: 'white', padding: '4px', borderRadius: '4px', display: 'block', marginBottom: '0.5rem' }}>First Name, Last Name, Car Number, Den</code>
                    <p style={{ marginBottom: 0 }}>The 'Den' column is optional. It will attempt to match existing Dens by name.</p>
                </div>

                <div>
                    <input 
                        type="file" 
                        accept=".csv"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                        style={{ display: 'block', width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                </div>

                {status && (
                    <div style={{ 
                        padding: '1rem', 
                        borderRadius: '8px', 
                        backgroundColor: status.type === 'success' ? '#e6fffa' : '#fff5f5',
                        color: status.type === 'success' ? '#006064' : '#c53030',
                        border: `1px solid ${status.type === 'success' ? '#b2f5ea' : '#feb2b2'}`
                    }}>
                        <p style={{ margin: 0, fontWeight: 'bold' }}>{status.message}</p>
                        {status.errors && status.errors.length > 0 && (
                            <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.5rem' }}>
                                {status.errors.map((err, i) => <li key={i}>{err}</li>)}
                            </ul>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button 
                        onClick={handleUpload} 
                        disabled={!file || uploading} 
                        className="primary-btn" 
                        style={{ flex: 1 }}
                    >
                        {uploading ? 'Uploading...' : 'Upload CSV'}
                    </button>
                    <button 
                        onClick={handleClose} 
                        className="secondary-btn"
                        style={{ background: 'transparent', border: '1px solid #ddd' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </Modal>
    );
}
