import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'urql';
import Modal from './Modal';
import { UPLOAD_IMAGE, BULK_ASSIGN_PHOTOS } from '../graphql/raceDetails';
import { useAlert } from '../context/AlertContext';

type UploadStatus = 'uploading' | 'done' | 'error';

interface PhotoEntry {
    localId: string;
    file: File;
    objectUrl: string;
    status: UploadStatus;
    uploadedUrl?: string;
    assignedRacerId?: number;
    photoType: 'racer' | 'car';
}

interface RacerOption {
    id: number;
    first_name: string;
    last_name: string;
    car_number?: number | null;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    racers: RacerOption[];
}

function racerLabel(r: RacerOption) {
    return r.car_number != null ? `#${r.car_number} ${r.first_name} ${r.last_name}` : `${r.first_name} ${r.last_name}`;
}

// ---------- Combobox ----------

interface ComboboxProps {
    racers: RacerOption[];
    value?: number;
    onChange: (racerId: number | undefined) => void;
}

function RacerCombobox({ racers, value, onChange }: ComboboxProps) {
    const assigned = racers.find(r => r.id === value);
    const [inputValue, setInputValue] = useState(assigned ? racerLabel(assigned) : '');
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Keep input text in sync when external value changes (e.g. on initial render)
    useEffect(() => {
        if (!isOpen) {
            setInputValue(assigned ? racerLabel(assigned) : '');
        }
    }, [value, assigned, isOpen]);

    const query = inputValue.trim().toLowerCase();
    const filtered = query
        ? racers.filter(r => racerLabel(r).toLowerCase().includes(query))
        : racers;

    const handleFocus = () => {
        setInputValue('');
        setIsOpen(true);
        setActiveIndex(-1);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        setIsOpen(true);
        setActiveIndex(-1);
    };

    const commit = (racer: RacerOption | undefined) => {
        onChange(racer?.id);
        setInputValue(racer ? racerLabel(racer) : '');
        setIsOpen(false);
        setActiveIndex(-1);
    };

    const handleBlur = (e: React.FocusEvent) => {
        // Ignore blur when focus moves to the dropdown list
        if (containerRef.current?.contains(e.relatedTarget as Node)) return;
        // If user typed something but didn't select, restore previous value
        setInputValue(assigned ? racerLabel(assigned) : '');
        setIsOpen(false);
        setActiveIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') { setIsOpen(true); return; }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, -1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && filtered[activeIndex]) commit(filtered[activeIndex]);
            else if (filtered.length === 1) commit(filtered[0]);
        } else if (e.key === 'Escape') {
            setInputValue(assigned ? racerLabel(assigned) : '');
            setIsOpen(false);
            setActiveIndex(-1);
        } else if (e.key === 'Backspace' && inputValue === '') {
            commit(undefined);
        }
    };

    // Scroll active item into view
    useEffect(() => {
        if (activeIndex >= 0 && listRef.current) {
            const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
            item?.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex]);

    return (
        <div ref={containerRef} style={{ position: 'relative', marginBottom: '6px' }}>
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                placeholder="— Assign to racer —"
                onFocus={handleFocus}
                onChange={handleInputChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontSize: '0.85rem',
                    padding: '4px 7px',
                    borderRadius: '4px',
                    border: `1px solid ${isOpen ? 'var(--scouting-blue)' : '#ccc'}`,
                    outline: 'none',
                }}
            />
            {isOpen && (
                <ul
                    ref={listRef}
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 200,
                        margin: '2px 0 0',
                        padding: 0,
                        listStyle: 'none',
                        background: 'white',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                        maxHeight: '180px',
                        overflowY: 'auto',
                    }}
                >
                    {filtered.length === 0 ? (
                        <li style={{ padding: '6px 8px', color: '#888', fontSize: '0.85rem' }}>No matches</li>
                    ) : (
                        filtered.map((r, i) => (
                            <li
                                key={r.id}
                                onMouseDown={(e) => { e.preventDefault(); commit(r); }}
                                onMouseEnter={() => setActiveIndex(i)}
                                style={{
                                    padding: '5px 8px',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    background: i === activeIndex ? 'var(--scouting-blue)' : 'white',
                                    color: i === activeIndex ? 'white' : 'inherit',
                                }}
                            >
                                {racerLabel(r)}
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}

// ---------- Helpers ----------

const BROWSER_SAFE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function isBrowserSafe(file: File) {
    if (BROWSER_SAFE_TYPES.includes(file.type)) return true;
    const ext = file.name.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext ?? '');
}

function PhotoPreview({ entry }: { entry: PhotoEntry }) {
    // If we have an uploaded URL, it's definitely safe (backend converted it to PNG if needed)
    if (entry.uploadedUrl) {
        return (
            <img
                src={entry.uploadedUrl}
                alt={entry.file.name}
                style={{
                    width: 80,
                    height: 80,
                    objectFit: 'cover',
                    borderRadius: '6px',
                    flexShrink: 0,
                    border: '1px solid #ddd',
                }}
            />
        );
    }

    // If still uploading/error and not browser-safe, show a placeholder
    if (!isBrowserSafe(entry.file)) {
        return (
            <div style={{
                width: 80,
                height: 80,
                borderRadius: '6px',
                background: '#f0f0f0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.65rem',
                color: '#888',
                textAlign: 'center',
                border: '1px solid #ddd',
                flexShrink: 0,
                padding: '0 4px',
                boxSizing: 'border-box'
            }}>
                <span style={{ fontSize: '1.2rem', marginBottom: '2px' }}>⏳</span>
                {entry.status === 'uploading' ? 'Converting...' : 'HEIC File'}
            </div>
        );
    }

    // Otherwise show local object URL
    return (
        <img
            src={entry.objectUrl}
            alt={entry.file.name}
            style={{
                width: 80,
                height: 80,
                objectFit: 'cover',
                borderRadius: '6px',
                flexShrink: 0,
                border: '1px solid #ddd',
            }}
        />
    );
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ---------- Modal ----------

export default function BulkPhotoUploadModal({ isOpen, onClose, onSuccess, racers }: Props) {
    const { showAlert } = useAlert();
    const [photos, setPhotos] = useState<PhotoEntry[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [, uploadMutation] = useMutation(UPLOAD_IMAGE);
    const [, bulkAssignMutation] = useMutation(BULK_ASSIGN_PHOTOS);

    const uploadEntry = async (entry: PhotoEntry) => {
        try {
            const dataUrl = await readFileAsDataUrl(entry.file);
            const result = await uploadMutation({ dataUrl });
            if (result.error) throw result.error;
            setPhotos(prev => prev.map(p =>
                p.localId === entry.localId
                    ? { ...p, status: 'done', uploadedUrl: result.data.uploadImage }
                    : p
            ));
        } catch {
            setPhotos(prev => prev.map(p =>
                p.localId === entry.localId ? { ...p, status: 'error' } : p
            ));
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;
        const entries: PhotoEntry[] = files.map(f => ({
            localId: crypto.randomUUID(),
            file: f,
            objectUrl: URL.createObjectURL(f),
            status: 'uploading',
            photoType: 'racer',
        }));
        setPhotos(prev => [...prev, ...entries]);
        await Promise.all(entries.map(uploadEntry));
        e.target.value = '';
    };

    const handleRemove = (localId: string) => {
        setPhotos(prev => {
            const entry = prev.find(p => p.localId === localId);
            if (entry) URL.revokeObjectURL(entry.objectUrl);
            return prev.filter(p => p.localId !== localId);
        });
    };

    const handleClose = () => {
        photos.forEach(p => URL.revokeObjectURL(p.objectUrl));
        setPhotos([]);
        onClose();
    };

    const handleApply = async () => {
        const ready = photos.filter(p => p.status === 'done' && p.assignedRacerId && p.uploadedUrl);
        if (ready.length === 0) return;
        const result = await bulkAssignMutation({
            assignments: ready.map(p => ({
                racerId: p.assignedRacerId!,
                url: p.uploadedUrl!,
                photoType: p.photoType,
            })),
        });
        if (result.error) {
            showAlert('Failed to save photo assignments.', 'Error');
            return;
        }
        showAlert(`${result.data.bulkAssignPhotos} photo(s) assigned successfully.`, 'Success');
        onSuccess();
        handleClose();
    };

    const sortedRacers = [...racers].sort((a, b) => {
        const numA = a.car_number ?? Infinity;
        const numB = b.car_number ?? Infinity;
        if (numA !== numB) return numA - numB;
        return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });

    const assignedCount = photos.filter(p => p.status === 'done' && p.assignedRacerId).length;
    const isAnyUploading = photos.some(p => p.status === 'uploading');

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Upload & Assign Photos" maxWidth="820px">
            <p style={{ marginTop: 0, color: '#555', fontSize: '0.9rem' }}>
                Select one or more images. Each photo uploads immediately. Use the search box to assign each photo to a racer, then click Apply.
            </p>

            {racers.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>No racers registered yet. Add racers before uploading photos.</p>
            ) : (
                <>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                    <button
                        className="secondary-btn"
                        onClick={() => fileInputRef.current?.click()}
                        style={{ marginBottom: '1rem' }}
                    >
                        Choose Photos
                    </button>
                </>
            )}

            {photos.length > 0 && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '12px',
                    maxHeight: '50vh',
                    overflowY: 'auto',
                    paddingRight: '4px',
                }}>
                    {photos.map(entry => (
                        <div key={entry.localId} style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px',
                            padding: '10px',
                            border: '1px solid #e0e0e0',
                            borderRadius: '8px',
                            background: entry.status === 'error' ? '#fff5f5' : 'white',
                        }}>
                            <PhotoPreview entry={entry} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.8rem', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                                    {entry.file.name}
                                </div>
                                {entry.status === 'uploading' && (
                                    <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '6px' }}>Uploading...</div>
                                )}
                                {entry.status === 'error' && (
                                    <div style={{ fontSize: '0.8rem', color: '#c00', marginBottom: '6px' }}>
                                        Upload failed.{' '}
                                        <button
                                            style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', cursor: 'pointer', padding: 0, fontSize: '0.8rem', textDecoration: 'underline' }}
                                            onClick={() => {
                                                setPhotos(prev => prev.map(p =>
                                                    p.localId === entry.localId ? { ...p, status: 'uploading' } : p
                                                ));
                                                uploadEntry({ ...entry, status: 'uploading' });
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                                {entry.status === 'done' && (
                                    <>
                                        <RacerCombobox
                                            racers={sortedRacers}
                                            value={entry.assignedRacerId}
                                            onChange={racerId => setPhotos(prev => prev.map(p =>
                                                p.localId === entry.localId ? { ...p, assignedRacerId: racerId } : p
                                            ))}
                                        />
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <input
                                                    type="radio"
                                                    name={`type-${entry.localId}`}
                                                    checked={entry.photoType === 'racer'}
                                                    onChange={() => setPhotos(prev => prev.map(p =>
                                                        p.localId === entry.localId ? { ...p, photoType: 'racer' } : p
                                                    ))}
                                                />
                                                Racer photo
                                            </label>
                                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <input
                                                    type="radio"
                                                    name={`type-${entry.localId}`}
                                                    checked={entry.photoType === 'car'}
                                                    onChange={() => setPhotos(prev => prev.map(p =>
                                                        p.localId === entry.localId ? { ...p, photoType: 'car' } : p
                                                    ))}
                                                />
                                                Car photo
                                            </label>
                                        </div>
                                    </>
                                )}
                            </div>
                            <button
                                onClick={() => handleRemove(entry.localId)}
                                title="Remove"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                <span style={{ fontSize: '0.9rem', color: '#555' }}>
                    {photos.length > 0
                        ? `${assignedCount} of ${photos.filter(p => p.status === 'done').length} uploaded photo(s) assigned`
                        : 'No photos selected yet'}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="secondary-btn" onClick={handleClose}>Cancel</button>
                    <button
                        className="secondary-btn"
                        onClick={handleApply}
                        disabled={assignedCount === 0 || isAnyUploading}
                        style={{
                            backgroundColor: assignedCount > 0 && !isAnyUploading ? 'var(--scouting-blue)' : undefined,
                            color: assignedCount > 0 && !isAnyUploading ? 'white' : undefined,
                            opacity: assignedCount === 0 || isAnyUploading ? 0.5 : 1,
                        }}
                    >
                        Apply {assignedCount > 0 ? `${assignedCount} Assignment(s)` : ''}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
