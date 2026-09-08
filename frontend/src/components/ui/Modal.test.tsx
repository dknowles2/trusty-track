// @vitest-environment jsdom
import '../../setupTests';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

afterEach(cleanup);

function TestModalHarness({
    defaultOpen = false,
    hasAutoFocusInput = false,
}: {
    defaultOpen?: boolean;
    hasAutoFocusInput?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div>
            <button
                type="button"
                data-testid="outside-button-before"
                onClick={() => setOpen(true)}
            >
                Open Modal
            </button>
            <input
                type="text"
                data-testid="outside-input"
                placeholder="Outside Input"
            />
            <Modal isOpen={open} onClose={() => setOpen(false)} title="Test Dialog">
                <form data-testid="modal-form" onSubmit={(e) => e.preventDefault()}>
                    {hasAutoFocusInput ? (
                        <input
                            type="text"
                            data-testid="autofocus-input"
                            placeholder="Autofocus Field"
                            autoFocus
                        />
                    ) : (
                        <input
                            type="text"
                            data-testid="first-input"
                            placeholder="First Field"
                        />
                    )}
                    <input
                        type="text"
                        data-testid="second-input"
                        placeholder="Second Field"
                    />
                    <button type="submit" data-testid="submit-btn">
                        Submit
                    </button>
                    <button
                        type="button"
                        data-testid="cancel-btn"
                        onClick={() => setOpen(false)}
                    >
                        Cancel
                    </button>
                </form>
            </Modal>
            <button type="button" data-testid="outside-button-after">
                Outside Button After
            </button>
        </div>
    );
}

describe('Modal accessibility and focus management (#788)', () => {
    it('focuses the first focusable element when opened without autoFocus', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        await user.click(openBtn);

        const firstInput = screen.getByTestId('first-input');
        expect(document.activeElement).toBe(firstInput);
    });

    it('focuses the autoFocus element when present inside modal', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} hasAutoFocusInput={true} />);

        const openBtn = screen.getByTestId('outside-button-before');
        await user.click(openBtn);

        const autoFocusInput = screen.getByTestId('autofocus-input');
        expect(document.activeElement).toBe(autoFocusInput);
    });

    it('traps Tab navigation within the modal', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={true} />);

        const firstInput = screen.getByTestId('first-input');
        const secondInput = screen.getByTestId('second-input');
        const submitBtn = screen.getByTestId('submit-btn');
        const cancelBtn = screen.getByTestId('cancel-btn');
        const closeBtn = screen.getByRole('button', { name: '×' });

        expect(document.activeElement).toBe(firstInput);

        await user.tab();
        expect(document.activeElement).toBe(secondInput);

        await user.tab();
        expect(document.activeElement).toBe(submitBtn);

        await user.tab();
        expect(document.activeElement).toBe(cancelBtn);

        await user.tab();
        expect(document.activeElement).toBe(closeBtn);

        // Wrapping forward around to first element
        await user.tab();
        expect(document.activeElement).toBe(firstInput);

        // Wrapping backward from first element to last element
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(closeBtn);
    });

    it('restores focus to triggering element when closed', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        await user.click(openBtn);

        expect(screen.getByTestId('first-input')).toBeInTheDocument();

        const cancelBtn = screen.getByTestId('cancel-btn');
        await user.click(cancelBtn);

        expect(screen.queryByTestId('first-input')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(openBtn);
    });
});

// A nested modal (#788's own focus trap opened the door to it) mirrors the
// real shape of the bug: an editor open first, an alert raised over it once
// a save is refused (#765/#807). `outerOpen` and `innerOpen` are independent
// state, and the inner Modal is always mounted — same as AlertContext, which
// always renders its own <Modal> and toggles `isOpen` — so the inner one's
// stack registration happens strictly after the outer's, exactly as it does
// when an alert is raised over an already-open editor.
function StackedModalHarness({
    onCloseOuter,
    onCloseInner,
}: {
    onCloseOuter: () => void;
    onCloseInner: () => void;
}) {
    const [outerOpen, setOuterOpen] = useState(true);
    const [innerOpen, setInnerOpen] = useState(false);

    return (
        <div>
            <button
                type="button"
                data-testid="raise-inner"
                onClick={() => setInnerOpen(true)}
            >
                Raise inner modal
            </button>
            <Modal
                isOpen={outerOpen}
                onClose={() => {
                    setOuterOpen(false);
                    onCloseOuter();
                }}
                title="Outer"
            >
                <div data-testid="outer-content">Outer content</div>
                <Modal
                    isOpen={innerOpen}
                    onClose={() => {
                        setInnerOpen(false);
                        onCloseInner();
                    }}
                    title="Inner"
                >
                    <div data-testid="inner-content">Inner content</div>
                </Modal>
            </Modal>
        </div>
    );
}

describe('Modal stacking — Escape and scroll lock (#870)', () => {
    it('one Escape closes only the topmost modal, not every open modal', async () => {
        const user = userEvent.setup();
        const onCloseOuter = vi.fn();
        const onCloseInner = vi.fn();
        render(<StackedModalHarness onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);

        await user.click(screen.getByTestId('raise-inner'));
        expect(screen.getByTestId('inner-content')).toBeInTheDocument();
        expect(screen.getByTestId('outer-content')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        // Only the inner (topmost, most-recently-raised) modal responds.
        expect(onCloseInner).toHaveBeenCalledTimes(1);
        expect(onCloseOuter).not.toHaveBeenCalled();
        expect(screen.queryByTestId('inner-content')).not.toBeInTheDocument();
        expect(screen.getByTestId('outer-content')).toBeInTheDocument();

        // A second Escape now reaches the outer modal, since it is topmost
        // once the inner one is gone.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCloseOuter).toHaveBeenCalledTimes(1);
    });

    it('keeps scrolling locked until the last open modal closes, even out of order', async () => {
        const user = userEvent.setup();
        const onCloseOuter = vi.fn();
        const onCloseInner = vi.fn();
        const { rerender } = render(
            <StackedModalHarness onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />,
        );

        expect(document.body.style.overflow).toBe('hidden');

        await user.click(screen.getByTestId('raise-inner'));
        expect(document.body.style.overflow).toBe('hidden');

        // Close the inner modal directly (not via Escape) — the nested
        // modal unmounting must not re-enable scrolling while the outer
        // modal is still open.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('inner-content')).not.toBeInTheDocument();
        expect(document.body.style.overflow).toBe('hidden');

        // Unmounting the whole tree without an orderly close (e.g. a route
        // change) must not leave the lock counter positive forever.
        rerender(<div />);
        expect(document.body.style.overflow).toBe('unset');
    });
});
