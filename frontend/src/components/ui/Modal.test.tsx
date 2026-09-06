// @vitest-environment jsdom
import '../../setupTests';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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
        </div>
    );
}

describe('Modal accessibility and focus management (#788)', () => {
    it('autofocuses inside the modal on open, rather than leaving focus on the trigger', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        openBtn.focus();
        expect(document.activeElement).toBe(openBtn);

        await user.click(openBtn);

        // Focus must have moved inside the modal (not stayed on the trigger)
        const modal = screen.getByRole('dialog');
        expect(modal.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(openBtn);
    });

    it('focuses the element with autoFocus if present, otherwise the first focusable element', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<TestModalHarness defaultOpen={false} hasAutoFocusInput={true} />);

        const openBtn = screen.getByTestId('outside-button-before');
        openBtn.focus();
        await user.click(openBtn);

        const autoFocusInput = screen.getByTestId('autofocus-input');
        expect(document.activeElement).toBe(autoFocusInput);

        unmount();

        // When no element has autoFocus, focus moves to the first focusable element
        render(<TestModalHarness defaultOpen={false} hasAutoFocusInput={false} />);
        const openBtn2 = screen.getByTestId('outside-button-before');
        openBtn2.focus();
        await user.click(openBtn2);

        const modal = screen.getByRole('dialog');
        const focusableInModal = modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        expect(document.activeElement).toBe(focusableInModal[0]);
    });

    it('restores focus to the triggering element when the modal is closed', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        openBtn.focus();
        expect(document.activeElement).toBe(openBtn);

        await user.click(openBtn);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Close via Cancel button
        const cancelBtn = screen.getByTestId('cancel-btn');
        await user.click(cancelBtn);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(openBtn);
    });

    it('restores focus to the triggering element when closed via Escape', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        openBtn.focus();
        await user.click(openBtn);

        expect(screen.getByRole('dialog')).toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(openBtn);
    });

    it('restores focus to the triggering element when closed via backdrop click', async () => {
        const user = userEvent.setup();
        render(<TestModalHarness defaultOpen={false} />);

        const openBtn = screen.getByTestId('outside-button-before');
        openBtn.focus();
        await user.click(openBtn);

        const modal = screen.getByRole('dialog');
        const backdrop = modal.parentElement!;

        // Click the backdrop directly
        await user.click(backdrop);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(openBtn);
    });

    it('traps focus inside the modal: Tab on the last element wraps to the first', () => {
        render(<TestModalHarness defaultOpen={true} />);

        const modal = screen.getByRole('dialog');
        const focusableInModal = Array.from(
            modal.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
        );
        const first = focusableInModal[0];
        const last = focusableInModal[focusableInModal.length - 1];

        // Focus the last element and press Tab
        last.focus();
        expect(document.activeElement).toBe(last);

        fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

        expect(document.activeElement).toBe(first);
    });

    it('traps focus inside the modal: Shift+Tab on the first element wraps to the last', () => {
        render(<TestModalHarness defaultOpen={true} />);

        const modal = screen.getByRole('dialog');
        const focusableInModal = Array.from(
            modal.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
        );
        const first = focusableInModal[0];
        const last = focusableInModal[focusableInModal.length - 1];

        // Focus the first element and press Shift+Tab
        first.focus();
        expect(document.activeElement).toBe(first);

        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(last);
    });

    it('pulls focus back into the modal if focus somehow slips outside', () => {
        render(<TestModalHarness defaultOpen={true} />);

        const modal = screen.getByRole('dialog');
        const outsideInput = screen.getByTestId('outside-input');
        outsideInput.focus();
        expect(document.activeElement).toBe(outsideInput);

        // Press Tab from outside
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

        const focusableInModal = modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        expect(document.activeElement).toBe(focusableInModal[0]);
    });
});
