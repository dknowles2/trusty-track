import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { raceNameConfirmed } from '../deleteConfirmation';

interface DeleteLockedRaceModalProps {
    isOpen: boolean;
    raceName: string;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * A locked race stays deletable, but requires typing its exact name first
 * (#585). An unlocked race keeps the ordinary yes/no confirm — this is
 * specifically for the one an operator is least likely to be reading every
 * word of a dialog for: a race already marked done.
 */
export default function DeleteLockedRaceModal({ isOpen, raceName, onCancel, onConfirm }: DeleteLockedRaceModalProps) {
    const [typed, setTyped] = useState('');
    const confirmed = raceNameConfirmed(typed, raceName);

    const handleClose = () => {
        setTyped('');
        onCancel();
    };

    const handleConfirm = () => {
        if (!confirmed) return;
        setTyped('');
        onConfirm();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Delete locked race">
            <div style={{ marginBottom: '1rem' }}>
                <p>
                    <strong>{raceName}</strong> is locked. Deleting it cannot be undone, and will
                    remove every racer, racing group, round, heat and result it holds.
                </p>
                <p>
                    Type the race&apos;s name to confirm:
                </p>
                <input
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={raceName}
                    className="form-control"
                    aria-label="Type the race name to confirm deletion"
                    autoFocus
                />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                    type="button"
                    onClick={handleClose}
                    className="secondary-btn"
                    style={{ backgroundColor: 'var(--surface-strong-color)', color: 'var(--text-color)' }}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!confirmed}
                    className="primary-btn"
                    style={{ backgroundColor: 'var(--error)', color: 'var(--on-primary-color)' }}
                >
                    Delete race
                </button>
            </div>
        </Modal>
    );
}
