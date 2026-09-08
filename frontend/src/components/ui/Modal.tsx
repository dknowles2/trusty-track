import { ReactNode, useEffect, useId, useRef } from 'react';
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

// Module-level, not React state or context: every Modal instance — however
// deep in the tree, however unrelated its owner — shares one stack and one
// scroll-lock count. That is what lets "am I topmost" and "is anything still
// open" be answered without a provider every Modal user would otherwise have
// to remember to wrap in (#870's lesson: a rule reaching only the call sites
// that remember reaches only some of them). Escape used to close *every*
// open modal — AlertContext renders its own Modal for every alert, so an
// alert raised over a still-open editor (#765/#807, the Edit Results modal
// that must survive a refused save) closed both on one Escape, discarding
// exactly what #807 exists to keep.
//
// A plain array of ids in open order; the *last* entry is topmost. Order is
// "most recently opened", not "mounted first" or "declared first in JSX" —
// AlertContext's own Modal is mounted once, near the root, with `isOpen`
// toggling later; it only belongs on top once an alert actually raises it,
// which is exactly when it pushes.
let openModalStack: string[] = [];
let scrollLockCount = 0;

function pushModal(id: string) {
    openModalStack = [...openModalStack, id];
}

function popModal(id: string) {
    // Filtered by id rather than assumed to be the top of the stack: a modal
    // can close or unmount out of order — closed from underneath a modal
    // raised over it, or a parent tearing down its whole subtree without
    // ever calling onClose.
    openModalStack = openModalStack.filter((existingId) => existingId !== id);
}

function isTopmost(id: string): boolean {
    return openModalStack.length > 0 && openModalStack[openModalStack.length - 1] === id;
}

function lockScroll() {
    scrollLockCount += 1;
    if (scrollLockCount === 1) {
        document.body.style.overflow = 'hidden';
    }
}

function unlockScroll() {
    // Clamped rather than trusted to stay non-negative: push/unlock stay
    // paired through this module's own effect (see below), but a stray
    // extra unlock must not drive the count permanently negative, which
    // would mean no future modal could lock scrolling again.
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
        document.body.style.overflow = 'unset';
    }
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = '500px' }: ModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const triggerElementRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    // A stable per-instance id for the stack — not tied to isOpen, so the
    // same Modal re-opening still reads as "the same modal" to anything that
    // might (it doesn't currently, but this is the honest identity to use).
    const modalId = useId();

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    // Track triggering element when closed
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

        // Autofocus on open (#788):
        // If an element inside the modal is already focused, preserve it.
        // Otherwise, prioritize [autofocus], then first focusable element inside modal body/content
        // (so forms receive focus before the close button), or all focusables,
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
                const contentFocusables = contentRef.current
                    ? contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
                    : [];
                if (contentFocusables.length > 0) {
                    contentFocusables[0].focus();
                } else {
                    const focusables = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
                    if (focusables.length > 0) {
                        focusables[0].focus();
                    } else {
                        modalRef.current.focus();
                    }
                }
            }
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // Read the stack live, at keydown time, rather than trust
                // whatever it was when this listener was attached — a modal
                // that stops being topmost because something opened over it
                // (an alert raised over an editor mid-edit) must stop
                // responding to Escape without needing to know that
                // happened. Every open modal's own listener fires on this
                // keydown; only the one whose id is on top acts on it.
                if (isTopmost(modalId)) {
                    onCloseRef.current();
                }
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
        // This modal only just became open, so it is the most recently
        // opened one — the correct place for it in the stack regardless of
        // where it sits in the React tree or when it first mounted.
        pushModal(modalId);
        lockScroll();

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            popModal(modalId);
            unlockScroll();
            triggerElementRef.current?.focus?.();
        };
    }, [isOpen, modalId]);

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
                <div ref={contentRef}>
                    {children}
                </div>
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
