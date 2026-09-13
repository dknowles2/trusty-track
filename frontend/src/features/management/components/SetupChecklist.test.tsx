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
    hasScheduledHeats: true,
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

    it('reads the schedule step as outstanding, with a regenerate hint, for a round with no heats yet (#1088)', () => {
        render(
            <SetupChecklist
                progress={progress({
                    racingGroupCount: 1,
                    racerCount: 5,
                    checkedInCount: 5,
                    roundCount: 1,
                    hasScheduledHeats: false,
                })}
                onAction={{}}
            />,
        );

        const scheduleStep = screen.getByTestId('setup-step-schedule');
        expect(scheduleStep).toHaveAttribute('data-done', 'false');
        expect(scheduleStep).toHaveTextContent(/regenerate/i);
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

    it('tags awards and printables optional, and not the other four (#1091)', () => {
        render(<SetupChecklist progress={progress({ racingGroupCount: 2, racerCount: 9 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-awards')).toHaveTextContent('optional');
        expect(screen.getByTestId('setup-step-printables')).toHaveTextContent('optional');
        expect(screen.getByTestId('setup-step-racingGroups')).not.toHaveTextContent('optional');
        expect(screen.getByTestId('setup-step-racers')).not.toHaveTextContent('optional');
        expect(screen.getByTestId('setup-step-checkin')).not.toHaveTextContent('optional');
        expect(screen.getByTestId('setup-step-schedule')).not.toHaveTextContent('optional');
    });

    it('names the printables step generically in its row (#1091)', () => {
        render(<SetupChecklist progress={progress({ racingGroupCount: 2, racerCount: 9 })} onAction={{}} />);

        expect(screen.getByTestId('setup-step-printables')).toHaveTextContent('Print anything you need');
    });

    it('counts the collapsed line over the required four, listing outstanding optional work after it (#1091)', async () => {
        // Check-in has started, so the panel defaults to its collapsed
        // one-line form (#949) — the summary line is what this test reads.
        render(
            <SetupChecklist
                progress={progress({ racingGroupCount: 1, racerCount: 5, checkedInCount: 5, roundCount: 1 })}
                onAction={{}}
            />,
        );

        expect(screen.getByTestId('setup-checklist-summary')).toHaveTextContent(
            '4 of 4 done — optional: Set up awards',
        );
    });

    it('agrees with the collapsed line on the denominator, expanded or collapsed (#1115)', () => {
        // Before #1115 the expanded header counted all six steps ("2 of 6
        // done") while the collapsed line counted only the required four
        // ("2 of 4 done") — same moment, two different denominators. Render
        // the same progress both expanded (checkedInCount: 0) and collapsed
        // (checkedInCount > 0) and check both summaries say "of 4".
        const expandedProgress = progress({ racingGroupCount: 1, racerCount: 5, checkedInCount: 0 });
        const { unmount } = render(<SetupChecklist progress={expandedProgress} onAction={{}} />);
        expect(screen.getByTestId('setup-checklist-summary')).toHaveTextContent(/of 4 done/);
        unmount();

        const collapsedProgress = progress({ racingGroupCount: 1, racerCount: 5, checkedInCount: 5, roundCount: 1 });
        render(<SetupChecklist progress={collapsedProgress} onAction={{}} />);
        expect(screen.getByTestId('setup-checklist-summary')).toHaveTextContent(/4 of 4 done/);
    });
});
