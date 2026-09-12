import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SetupChecklist from './SetupChecklist';
import type { SetupProgress } from '../setupChecklist';

const progress = (over: Partial<SetupProgress> = {}): SetupProgress => ({
    racingGroupCount: 0,
    racerCount: 0,
    checkedInCount: 0,
    roundCount: 0,
    awardCount: 0,
    isLocked: false,
    ...over,
});

describe('SetupChecklist', () => {
    it('renders nothing once the race is set up', () => {
        render(
            <SetupChecklist
                progress={progress({
                    racingGroupCount: 1,
                    racerCount: 5,
                    checkedInCount: 5,
                    roundCount: 1,
                    awardCount: 2,
                })}
                onAction={{}}
            />,
        );

        expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument();
    });

    it('still shows while awards are undefined and the race is not locked (#847)', () => {
        render(
            <SetupChecklist
                progress={progress({ racingGroupCount: 1, racerCount: 5, checkedInCount: 5, roundCount: 1 })}
                onAction={{}}
            />,
        );

        expect(screen.getByTestId('setup-checklist')).toBeInTheDocument();
        expect(screen.getByTestId('setup-step-awards')).toHaveAttribute('data-done', 'false');
    });

    it('quiets the awards and printables steps once the race is locked', () => {
        render(
            <SetupChecklist
                progress={progress({
                    racingGroupCount: 1,
                    racerCount: 5,
                    checkedInCount: 5,
                    roundCount: 1,
                    isLocked: true,
                })}
                onAction={{}}
            />,
        );

        expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument();
    });

    it('renders a skipped step muted, with no tick and a "no longer needed" note, never done (#1000)', () => {
        // Printables can never be genuinely `done` (nothing tracks a sheet
        // actually coming out of a printer), and it must not read as though
        // it were: no tick, no strikethrough, distinct from `done`.
        render(
            <SetupChecklist
                progress={progress({ racingGroupCount: 1, racerCount: 5, checkedInCount: 1 })}
                onAction={{}}
            />,
        );

        const printables = screen.getByTestId('setup-step-printables');
        expect(printables).toHaveAttribute('data-done', 'false');
        expect(printables).toHaveAttribute('data-skipped', 'true');
        expect(printables).toHaveTextContent('no longer needed');
    });

    it('does not tick "Check in cars" at the first of several racers (#1000)', () => {
        render(
            <SetupChecklist
                progress={progress({ racingGroupCount: 1, racerCount: 11, checkedInCount: 1 })}
                onAction={{}}
            />,
        );

        const checkin = screen.getByTestId('setup-step-checkin');
        expect(checkin).toHaveAttribute('data-done', 'false');
        expect(checkin).toHaveAttribute('data-skipped', 'false');
        expect(screen.getByText(/1 of 11 checked in/)).toBeInTheDocument();
    });

    it('offers a button only for the step you are actually on', () => {
        // All four at once is a wall of buttons on a page whose job is to get
        // somebody moving.
        render(<SetupChecklist progress={progress()} onAction={{ racingGroups: vi.fn(), racers: vi.fn() }} />);

        expect(screen.getByRole('button', { name: 'Set up dens' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add your first racer' })).not.toBeInTheDocument();
    });

    it('does not put a second "Add Racer" button on the page', () => {
        // The roster toolbar already has one. Two controls with the same
        // accessible name is ambiguous to a screen reader and to a person.
        render(<SetupChecklist progress={progress({ racerCount: 0, racingGroupCount: 2 })} onAction={{ racers: vi.fn() }} />);

        expect(screen.queryByRole('button', { name: /^Add Racer$/ })).not.toBeInTheDocument();
    });

    it('runs the handler for the step it is pointing at', async () => {
        const racers = vi.fn();
        render(<SetupChecklist progress={progress({ racingGroupCount: 1 })} onAction={{ racers }} />);

        await userEvent.click(screen.getByRole('button', { name: 'Add your first racer' }));

        expect(racers).toHaveBeenCalled();
    });

    it('shows a step with no handler without a dead button', () => {
        // Check-in happens on the rows below; there is no single control for it.
        render(<SetupChecklist progress={progress({ racingGroupCount: 1, racerCount: 4 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-checkin')).toHaveAttribute('data-done', 'false');
        expect(screen.getByText(/0 of 4 checked in/)).toBeInTheDocument();
    });

    it('marks the steps that are behind us', () => {
        render(<SetupChecklist progress={progress({ racingGroupCount: 2, racerCount: 9 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-racingGroups')).toHaveAttribute('data-done', 'true');
        expect(screen.getByTestId('setup-step-schedule')).toHaveAttribute('data-done', 'false');
    });
});
