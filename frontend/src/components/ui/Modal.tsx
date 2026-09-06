import { ReactNode, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    maxWidth?: string;
}

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function Modal({ isOpen, onClose, title, children, maxWidth = '500px' }: ModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const triggerElementRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    // Track the last focused element outside the modal to restore on close (#788)
    useEffect(() => {
        if (!isOpen) {
            if (document.activeElement instanceof HTMLElement) {
                triggerElementRef.current = document.activeElement;
            }
            const handleFocusIn = () => {
                if (document.activeElement instanceof HTMLElement) {
                    triggerElementRef.current = document.activeElement;
                }
            };
            document.addEventListener('focusin', handleFocusIn);
            return () => document.removeEventListener('focusin', handleFocusIn);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        if (
            document.activeElement instanceof HTMLElement &&
            (!modalRef.current || !modalRef.current.contains(document.activeElement))
        ) {
            triggerElementRef.current = document.activeElement;
        }

        // Autofocus on open:
        // If an element inside the modal is already focused (e.g. via React's autoFocus prop),
        // preserve it. Otherwise, prioritize [autofocus], then first focusable element,
        // or the modal container itself.
        const isAlreadyFocusedInside =
            modalRef.current &&
            document.activeElement &&
            modalRef.current.contains(document.activeElement) &&
            document.activeElement !== modalRef.current;

        if (!isAlreadyFocusedInside && modalRef.current) {
            const autoFocusEl = modalRef.current.querySelector<HTMLElement>('[autofocus]');
            if (autoFocusEl) {
                autoFocusEl.focus();
            } else {
                const focusables = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
                if (focusables.length > 0) {
                    focusables[0].focus();
                } else {
                    modalRef.current.focus();
                }
            }
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCloseRef.current();
                return;
            }

            if (e.key === 'Tab') {
                if (!modalRef.current) return;

                const focusableElements = Array.from(
                    modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
                );

                if (focusableElements.length === 0) {
                    e.preventDefault();
                    modalRef.current.focus();
                    return;
                }

                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) {
                    if (
                        document.activeElement === firstElement ||
                        document.activeElement === modalRef.current ||
                        !modalRef.current.contains(document.activeElement)
                    ) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (
                        document.activeElement === lastElement ||
                        document.activeElement === modalRef.current ||
                        !modalRef.current.contains(document.activeElement)
                    ) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'unset';
            triggerElementRef.current?.focus?.();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            onClick={(e) => {
                // Only close if clicking the backdrop itself, not the modal content
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'var(--overlay-backdrop-color)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
                backdropFilter: 'blur(2px)' // Premium feel
            }}
        >
            <div
                ref={modalRef}
                tabIndex={-1}
                // Announced as a dialog, and named by its own heading. Without
                // these it is an anonymous div: a screen reader gives no
                // indication that anything has opened.
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={{
                    background: 'var(--surface-color)',
                    padding: '2rem',
                    borderRadius: '12px',
                    width: '100%',
                    maxWidth: maxWidth,
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    position: 'relative',
                    animation: 'fadeIn 0.2s ease-out',
                    outline: 'none'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    {title && <h2 style={{ margin: 0 }}>{title}</h2>}
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            color: 'var(--text-faint-color)',
                            padding: '0 5px'
                        }}
                    >
                        ×
                    </button>
                </div>
                {children}
            </div>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>,
        document.body
    );
}
