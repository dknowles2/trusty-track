// @vitest-environment jsdom
import '../../setupTests';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
