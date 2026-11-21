import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { AlertProvider, useAlert } from './AlertContext';

describe('AlertContext', () => {
    it('assigns unique IDs to toasts created in the same tick and exposes accessible roles/labels', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        function TestComponent() {
            const { showToast } = useAlert();
            return (
                <button
                    onClick={() => {
                        showToast('First toast', 'info');
                        showToast('Second toast', 'success');
                    }}
                >
                    Trigger Toasts
                </button>
            );
        }

        render(
            <AlertProvider>
                <TestComponent />
            </AlertProvider>
        );

        fireEvent.click(screen.getByText('Trigger Toasts'));

        const statuses = screen.getAllByRole('status');
        expect(statuses).toHaveLength(2);
        expect(statuses[0]).toHaveTextContent('First toast');
        expect(statuses[1]).toHaveTextContent('Second toast');
        expect(statuses[0].parentElement).toHaveAttribute('aria-live', 'polite');

        // No duplicate React key warnings
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();

        // Dismissing only the first toast leaves the second toast intact
        const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
        expect(dismissButtons).toHaveLength(2);
        fireEvent.click(dismissButtons[0]);

        expect(screen.queryByText('First toast')).not.toBeInTheDocument();
        expect(screen.getByText('Second toast')).toBeInTheDocument();
    });

    it('resolves a prior pending showConfirm promise with false when a new showConfirm opens', async () => {
        const results: Array<{ which: string; value: boolean }> = [];

        function TestComponent() {
            const { showConfirm } = useAlert();
            return (
                <>
                    <button
                        onClick={() => {
                            showConfirm('First confirm?').then((value) => results.push({ which: 'first', value }));
                            showConfirm('Second confirm?').then((value) => results.push({ which: 'second', value }));
                        }}
                    >
                        Trigger Same Tick
                    </button>
                    <button
                        onClick={() => {
                            showConfirm('Third confirm?').then((value) => results.push({ which: 'third', value }));
                        }}
                    >
                        Trigger Third
                    </button>
                </>
            );
        }

        render(
            <AlertProvider>
                <TestComponent />
            </AlertProvider>
        );

        fireEvent.click(screen.getByText('Trigger Same Tick'));

        await waitFor(() => {
            expect(results).toContainEqual({ which: 'first', value: false });
        });
        expect(screen.getByText('Second confirm?')).toBeInTheDocument();

        // Open a third confirm across ticks before resolving the second
        fireEvent.click(screen.getByText('Trigger Third'));

        await waitFor(() => {
            expect(results).toContainEqual({ which: 'second', value: false });
        });
        expect(screen.getByText('Third confirm?')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() => {
            expect(results).toContainEqual({ which: 'third', value: true });
        });
    });

    it('resolves a pending showConfirm promise with false when showAlert supersedes it', async () => {
        const results: boolean[] = [];

        function TestComponent() {
            const { showConfirm, showAlert } = useAlert();
            return (
                <>
                    <button
                        onClick={() => {
                            showConfirm('Proceed?').then((value) => results.push(value));
                        }}
                    >
                        Open Confirm
                    </button>
                    <button onClick={() => showAlert('Something happened', 'Notice')}>
                        Open Alert
                    </button>
                </>
            );
        }

        render(
            <AlertProvider>
                <TestComponent />
            </AlertProvider>
        );

        fireEvent.click(screen.getByText('Open Confirm'));
        expect(screen.getByText('Proceed?')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Open Alert'));

        await waitFor(() => {
            expect(results).toEqual([false]);
        });
        expect(screen.getByText('Something happened')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        expect(results).toEqual([false]);
    });
});
