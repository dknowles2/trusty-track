import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'urql';
import Modal from '../../../components/ui/Modal';
import { UPLOAD_IMAGE, BULK_ASSIGN_PHOTOS } from '../graphql/queries';
import { useAlert } from '../../../context/AlertContext';
import { useTerminology } from '../../../context/TerminologyContext';

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
    const [prevValue, setPrevValue] = useState(value);

    // Keep input text in sync when external value changes (e.g. on initial render)
    if (value !== prevValue) {
        setPrevValue(value);
        if (!isOpen) {
            setInputValue(assigned ? racerLabel(assigned) : '');
        }
    }

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
        <div ref={containerRef} style={{ position: 'relative', marginBottom: '6px', zIndex: isOpen ? 100 : 1 }}>
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
                    border: `1px solid ${isOpen ? 'var(--scouting-blue)' : 'var(--input-border-color)'}`,
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
                        background: 'var(--surface-color)',
                        border: '1px solid var(--input-border-color)',
                        borderRadius: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                        maxHeight: '180px',
                        overflowY: 'auto',
                    }}
                >
                    {filtered.length === 0 ? (
                        <li style={{ padding: '6px 8px', color: 'var(--text-subtle-color)', fontSize: '0.85rem' }}>No matches</li>
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
                                    background: i === activeIndex ? 'var(--scouting-blue)' : 'var(--surface-color)',
                                    color: i === activeIndex ? 'var(--on-primary-color)' : 'inherit',
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
    const [remoteLoaded, setRemoteLoaded] = useState(false);
    const isSafe = isBrowserSafe(entry.file);

    // If it's a browser-safe image, always use the local objectUrl for previewing.
    // This is instant and avoids the flicker when switching to the remote URL.
    if (isSafe) {
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
                    border: '1px solid var(--border-color)',
                }}
            />
        );
    }

    // For non-browser-safe images (like HEIC), we must use the converted uploadedUrl
    if (entry.uploadedUrl) {
        return (
            <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                {!remoteLoaded && (
                    <div style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        background: 'var(--surface-soft-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.65rem',
                        color: 'var(--text-subtle-color)',
                        textAlign: 'center',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '0 4px',
                        boxSizing: 'border-box',
                        zIndex: 1,
                    }}>
                        <span style={{ fontSize: '1.2rem', marginBottom: '2px' }}>⏳</span>
                        Finalizing...
                    </div>
                )}
                <img
                    src={entry.uploadedUrl}
                    alt={entry.file.name}
                    onLoad={() => setRemoteLoaded(true)}
                    onError={() => setRemoteLoaded(true)}
                    style={{
                        width: 80,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: '6px',
                        flexShrink: 0,
                        border: '1px solid var(--border-color)',
                        display: remoteLoaded ? 'block' : 'none',
                    }}
                />
            </div>
        );
    }

    // Still uploading and not browser-safe
    return (
        <div style={{
            width: 80,
            height: 80,
            borderRadius: '6px',
            background: 'var(--surface-soft-color)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            color: 'var(--text-subtle-color)',
            textAlign: 'center',
            border: '1px solid var(--border-color)',
            flexShrink: 0,
            padding: '0 4px',
            boxSizing: 'border-box'
        }}>
            <span style={{ fontSize: '1.2rem', marginBottom: '2px' }}>⏳</span>
            {entry.status === 'uploading' ? 'Converting...' : 'HEIC File'}
        </div>
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
    const { vehicle } = useTerminology();
    const [photos, setPhotos] = useState<PhotoEntry[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [, uploadMutation] = useMutation(UPLOAD_IMAGE);
    const [, bulkAssignMutation] = useMutation(BULK_ASSIGN_PHOTOS);

    /** Upload one photo, sharing the request with any identical siblings.
     *
     * `inFlight` is keyed on the image's own bytes, so picking the same file
     * twice in one selection uploads it once and both entries take the answer.
     *
     * That is not only tidiness. urql keys an operation on its document plus
     * its variables, so two concurrent `uploadImage` mutations carrying an
     * identical data URL are the same key — and with the normalized cache in
     * the chain only one of them ever gets a result back. The others never
     * settled, so their photos sat on "Uploading…" forever and **Apply** stayed
     * disabled with no way out but closing the modal (#116). Issuing one
     * request per distinct image means there is nothing to collide.
     */
    const uploadEntry = async (entry: PhotoEntry, inFlight: Map<string, Promise<string>>) => {
        try {
            const dataUrl = await readFileAsDataUrl(entry.file);
            let pending = inFlight.get(dataUrl);
            if (!pending) {
                pending = uploadMutation({ dataUrl }).then(result => {
                    if (result.error) throw result.error;
                    return result.data.uploadImage as string;
                });
                inFlight.set(dataUrl, pending);
            }
            const uploadedUrl = await pending;
            setPhotos(prev => prev.map(p =>
                p.localId === entry.localId
                    ? { ...p, status: 'done', uploadedUrl }
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
        // Scoped to this selection: a photo picked again in a *later* selection
        // is a fresh upload, which keeps the map from growing for the life of
        // the modal and matches what the operator did.
        const inFlight = new Map<string, Promise<string>>();
        await Promise.all(entries.map(entry => uploadEntry(entry, inFlight)));
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
            <p style={{ marginTop: 0, color: 'var(--text-strong-muted-color)', fontSize: '0.9rem' }}>
                Select one or more images. Each photo uploads immediately. Use the search box to assign each photo to a racer, then click Apply.
            </p>

            {racers.length === 0 ? (
                <p style={{ color: 'var(--text-subtle-color)', fontStyle: 'italic' }}>No racers registered yet. Add racers before uploading photos.</p>
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
                            border: '1px solid var(--surface-strong-color)',
                            borderRadius: '8px',
                            background: entry.status === 'error' ? 'var(--danger-faint-bg-color)' : 'var(--surface-color)',
                        }}>
                            <PhotoPreview entry={entry} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-strong-muted-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                                    {entry.file.name}
                                </div>
                                {entry.status === 'uploading' && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle-color)', marginBottom: '6px' }}>Uploading...</div>
                                )}
                                {entry.status === 'error' && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--danger-plain-color)', marginBottom: '6px' }}>
                                        Upload failed.{' '}
                                        <button
                                            style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', cursor: 'pointer', padding: 0, fontSize: '0.8rem', textDecoration: 'underline' }}
                                            onClick={() => {
                                                setPhotos(prev => prev.map(p =>
                                                    p.localId === entry.localId ? { ...p, status: 'uploading' } : p
                                                ));
                                                // Its own map: a retry is one
                                                // photo, with nothing to share.
                                                uploadEntry({ ...entry, status: 'uploading' }, new Map());
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
                                                {vehicle} photo
                                            </label>
                                        </div>
                                    </>
                                )}
                            </div>
                            <button
                                onClick={() => handleRemove(entry.localId)}
                                title="Remove"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint-color)', fontSize: '1.2rem', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--divider-color)' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-strong-muted-color)' }}>
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
                            color: assignedCount > 0 && !isAnyUploading ? 'var(--on-primary-color)' : undefined,
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
