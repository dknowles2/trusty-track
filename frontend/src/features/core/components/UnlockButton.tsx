import { useState } from 'react';
import { Icon } from '@mdi/react';
import { mdiLock, mdiLockOpenVariant } from '@mdi/js';
import { clearPin, writePin } from '../../../api/pin';
import { verifyPin } from '../../../api/verifyPin';

/**
 * Enter the operator or check-in PIN on this device (#15).
 *
 * Shown only when the install actually has a PIN set, so an event that has not
 * turned enforcement on sees nothing at all — which is most of them, and is the
 * point of the feature being off by default.
 *
 * Reloads after a PIN is entered — but only a PIN the server has already
 * confirmed resolves to something other than `VIEWER` (#993). Before this,
 * a wrong guess was written to `localStorage` and the page reloaded anyway:
 * from the volunteer's side that read as the button doing nothing, and the
 * wrong PIN then rode along on every later request from that device. The
 * server is still the one place that decides what a PIN is worth; the
 * difference is asking it *before* committing to the guess, with
 * `verifyPin` — a raw request carrying the candidate PIN, never the urql
 * client or its cache — rather than after.
 */
export function UnlockButton({ isOperator }: { isOperator: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const [pin, setPin] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    const openDialog = () => {
        setPin('');
        setError(null);
        setIsOpen(true);
    };

    const closeDialog = () => {
        setIsOpen(false);
        setPin('');
        setError(null);
    };

    const unlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pin || isChecking) return;
        setIsChecking(true);
        setError(null);
        try {
            const role = await verifyPin(pin);
            if (role === 'VIEWER') {
                setError('That PIN is not right.');
                return;
            }
            // Only a PIN the server just confirmed is ever written.
            writePin(pin);
            window.location.reload();
        } catch {
            setError('Could not reach the server to check that PIN. Try again.');
        } finally {
            setIsChecking(false);
        }
    };

    const lock = () => {
        clearPin();
        window.location.reload();
    };

    if (isOperator) {
        return (
            <button
                type="button"
                onClick={lock}
                title="Forget the PIN on this device"
                aria-label="Forget the PIN on this device"
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--cub-scouting-gold)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <Icon path={mdiLockOpenVariant} size={0.8} />
            </button>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={openDialog}
                title="Enter the PIN to make changes"
                aria-label="Enter the PIN to make changes"
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--on-primary-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <Icon path={mdiLock} size={0.8} />
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="Enter PIN"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'var(--overlay-backdrop-soft-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2000,
                    }}
                    onClick={closeDialog}
                >
                    <form
                        onSubmit={unlock}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--surface-color)',
                            padding: '1.5rem',
                            borderRadius: '12px',
                            minWidth: '280px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                        }}
                    >
                        <h3 style={{ margin: 0, color: 'var(--scouting-blue)' }}>Enter PIN</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                            This screen can watch the race. A PIN is needed to change anything.
                        </p>
                        <label htmlFor="unlock-pin" style={{ fontSize: '0.9rem' }}>
                            PIN
                        </label>
                        <input
                            id="unlock-pin"
                            type="password"
                            inputMode="numeric"
                            autoFocus
                            value={pin}
                            onChange={(e) => {
                                setPin(e.target.value);
                                if (error) setError(null);
                            }}
                            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                        />
                        {error && (
                            <p role="status" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--error)' }}>
                                {error}
                            </p>
                        )}
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" className="primary-btn" disabled={isChecking} style={{ flex: 1 }}>
                                {isChecking ? 'Checking…' : 'Unlock'}
                            </button>
                            <button type="button" onClick={closeDialog} disabled={isChecking} style={{ flex: 1 }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    );
}
