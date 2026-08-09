import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SetupChecklist from './SetupChecklist';
import type { SetupProgress } from '../setupChecklist';

const progress = (over: Partial<SetupProgress> = {}): SetupProgress => ({
    denCount: 0,
    racerCount: 0,
    checkedInCount: 0,
    roundCount: 0,
    ...over,
});

describe('SetupChecklist', () => {
    it('renders nothing once the race is set up', () => {
        render(
            <SetupChecklist
                progress={progress({ denCount: 1, racerCount: 5, checkedInCount: 5, roundCount: 1 })}
                onAction={{}}
            />,
        );

        expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument();
    });

    it('offers a button only for the step you are actually on', () => {
        // All four at once is a wall of buttons on a page whose job is to get
        // somebody moving.
        render(<SetupChecklist progress={progress()} onAction={{ dens: vi.fn(), racers: vi.fn() }} />);

        expect(screen.getByRole('button', { name: 'Set up dens' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add your first racer' })).not.toBeInTheDocument();
    });

    it('does not put a second "Add Racer" button on the page', () => {
        // The roster toolbar already has one. Two controls with the same
        // accessible name is ambiguous to a screen reader and to a person.
        render(<SetupChecklist progress={progress({ racerCount: 0, denCount: 2 })} onAction={{ racers: vi.fn() }} />);

        expect(screen.queryByRole('button', { name: /^Add Racer$/ })).not.toBeInTheDocument();
    });

    it('runs the handler for the step it is pointing at', async () => {
        const racers = vi.fn();
        render(<SetupChecklist progress={progress({ denCount: 1 })} onAction={{ racers }} />);

        await userEvent.click(screen.getByRole('button', { name: 'Add your first racer' }));

        expect(racers).toHaveBeenCalled();
    });

    it('shows a step with no handler without a dead button', () => {
        // Check-in happens on the rows below; there is no single control for it.
        render(<SetupChecklist progress={progress({ denCount: 1, racerCount: 4 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-checkin')).toHaveAttribute('data-done', 'false');
        expect(screen.getByText(/0 of 4 checked in/)).toBeInTheDocument();
    });

    it('marks the steps that are behind us', () => {
        render(<SetupChecklist progress={progress({ denCount: 2, racerCount: 9 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-dens')).toHaveAttribute('data-done', 'true');
        expect(screen.getByTestId('setup-step-schedule')).toHaveAttribute('data-done', 'false');
    });
});
