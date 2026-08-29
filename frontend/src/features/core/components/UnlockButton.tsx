import { useState } from 'react';
import { Icon } from '@mdi/react';
import { mdiLock, mdiLockOpenVariant } from '@mdi/js';
import { clearPin, writePin } from '../../../api/pin';

/**
 * Enter the operator or check-in PIN on this device (#15).
 *
 * Shown only when the install actually has a PIN set, so an event that has not
 * turned enforcement on sees nothing at all — which is most of them, and is the
 * point of the feature being off by default.
 *
 * Reloads after a PIN is entered. That looks heavy-handed for four digits, and
 * it is the honest option: the subscription socket carries the PIN in its URL
 * because a WebSocket handshake cannot set headers, so a new PIN needs a new
 * socket. Tearing down and rebuilding the urql client and its normalized cache
 * mid-session to save a reload would be a great deal more machinery, and this
 * happens once per device per event.
 */
export function UnlockButton({ isOperator }: { isOperator: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const [pin, setPin] = useState('');

    const unlock = (e: React.FormEvent) => {
        e.preventDefault();
        if (!pin) return;
        writePin(pin);
        // Not validated here. The server decides what a PIN is worth, and a
        // wrong one lands the device back as a viewer — which is the same
        // state it was already in, so there is nothing to roll back.
        window.location.reload();
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
                onClick={() => setIsOpen(true)}
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
                    onClick={() => setIsOpen(false)}
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
                            onChange={(e) => setPin(e.target.value)}
                            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" className="primary-btn" style={{ flex: 1 }}>
                                Unlock
                            </button>
                            <button type="button" onClick={() => setIsOpen(false)} style={{ flex: 1 }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    );
}
