// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CheckInDisplayView from './CheckInDisplayView';
import type { CheckInRacer } from '../checkIn';

afterEach(cleanup);

const RACING_GROUPS = [
    { id: 1, name: 'Wolves', color: '#f00' },
    { id: 2, name: 'Bears', color: '#0f0' },
];

const racer = (over: Partial<CheckInRacer> & { id: number }): CheckInRacer => ({
    firstName: 'Jordan',
    lastName: 'Mitchell',
    carNumber: null,
    carPassedInspection: false,
    racingGroupId: undefined,
    ...over,
});

function renderView(overrides: Partial<React.ComponentProps<typeof CheckInDisplayView>> = {}) {
    return render(
        <CheckInDisplayView
            racers={[
                racer({ id: 1, firstName: 'Ada', lastName: 'Lovelace', carNumber: 5, racingGroupId: 1, carPassedInspection: true }),
                racer({ id: 2, firstName: 'Grace', lastName: 'Hopper', carNumber: 3, racingGroupId: 1, carPassedInspection: false }),
                racer({ id: 3, firstName: 'Katherine', lastName: 'Johnson', carNumber: 8, racingGroupId: 2, carPassedInspection: true }),
            ]}
            racingGroups={RACING_GROUPS}
            nameDisplay="FULL"
            groupWord="Den"
            showCheckedIn={true}
            racingHasBegun={false}
            {...overrides}
        />,
    );
}

describe('CheckInDisplayView (#612)', () => {
    it('says what it is, for the full-screen-view plumbing to hook onto', () => {
        renderView();
        expect(screen.getByTestId('checkin-view')).toBeInTheDocument();
    });

    it('shows the "not yet open" state when nobody is registered', () => {
        renderView({ racers: [] });

        expect(screen.getByTestId('checkin-not-open')).toBeInTheDocument();
        expect(screen.getByText('Check-in has not opened yet.')).toBeInTheDocument();
    });

    it('shows nothing while the roster is still loading, rather than "not yet open"', () => {
        renderView({ racers: [], loading: true });

        expect(screen.getByTestId('checkin-loading')).toBeInTheDocument();
        expect(screen.queryByText('Check-in has not opened yet.')).not.toBeInTheDocument();
    });

    it('shows the overall progress count', () => {
        renderView();
        expect(screen.getByText('2 of 3 checked in')).toBeInTheDocument();
    });

    it('lists a pending racer, with car number, under their den', () => {
        renderView();
        expect(screen.getByTestId('checkin-group-1')).toHaveTextContent('#3 Grace Hopper');
    });

    it('lists an already-checked-in racer when showCheckedIn is on', () => {
        renderView({ showCheckedIn: true });
        expect(screen.getByTestId('checkin-group-1')).toHaveTextContent('Ada Lovelace');
    });

    it('drops already-checked-in racers when showCheckedIn is off', () => {
        renderView({ showCheckedIn: false });
        expect(screen.getByTestId('checkin-group-1')).not.toHaveTextContent('Ada Lovelace');
        // The pending racer is still there — the toggle only trims the done ones.
        expect(screen.getByTestId('checkin-group-1')).toHaveTextContent('Grace Hopper');
    });

    it('marks a fully checked-in group as done, with nobody listed as missing', () => {
        renderView();
        expect(screen.getByTestId('checkin-group-2')).toHaveTextContent('All checked in');
    });

    it('celebrates once every registered racer is through', () => {
        renderView({
            racers: [
                racer({ id: 1, racingGroupId: 1, carPassedInspection: true }),
                racer({ id: 2, racingGroupId: 2, carPassedInspection: true }),
            ],
        });

        expect(screen.getByText(/All 2 checked in!/)).toBeInTheDocument();
    });

    // #772 — this is a Display surface (assigned to a kiosk, not the
    // operator's own device), and `--success-color` is an App token that
    // lives in *this device's own* localStorage App theme, not the
    // per-install Display theme. Two kiosks showing the identical
    // `CHECKIN` assignment must render identically regardless of what App
    // theme either browser happens to hold, which only a Display-scoped
    // token can guarantee.
    it('reads the Display surface success token, not the App one (#772)', () => {
        renderView({
            racers: [
                racer({ id: 1, racingGroupId: 1, carPassedInspection: true }),
                racer({ id: 2, racingGroupId: 2, carPassedInspection: true }),
            ],
        });

        const celebration = screen.getByText(/All 2 checked in!/);
        expect(celebration).toHaveStyle({ color: 'var(--display-success-color)' });
        expect(celebration.style.color).not.toContain('--success-color)');
    });

    it('marks a fully checked-in group\'s note with the Display success token, not the App one (#772)', () => {
        renderView();
        const done = screen.getByText('All checked in ✓');
        expect(done).toHaveStyle({ color: 'var(--display-success-color)' });
    });

    it('abbreviates names the same way every other public display does', () => {
        renderView({ nameDisplay: 'LAST_INITIAL' });
        expect(screen.getByTestId('checkin-group-1')).toHaveTextContent('Grace H.');
        expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    });

    it('says racing is underway once a heat has been recorded, without hiding the roster', () => {
        renderView({ racingHasBegun: true });

        expect(screen.getByTestId('checkin-racing-underway')).toBeInTheDocument();
        // Still functions — a latecomer can still check in (#172).
        expect(screen.getByTestId('checkin-view')).toBeInTheDocument();
        expect(screen.getByTestId('checkin-group-1')).toHaveTextContent('Grace Hopper');
    });

    it('says nothing about racing before the first heat is recorded', () => {
        renderView({ racingHasBegun: false });
        expect(screen.queryByTestId('checkin-racing-underway')).not.toBeInTheDocument();
    });

    // The phone tier (#1144): a parent's phone rather than a wall display.
    // The `vmin`-sized `auto-fit` grid reads as three 120px dens at 7.8px
    // names on a 390px screen — the failure the issue reported — because it
    // was tuned for a floor of 800px wide.
    describe('the phone tier (#1144)', () => {
        it('stacks one den per row instead of the auto-fit grid', () => {
            renderView({ phoneTier: true });
            const grid = screen.getByTestId('checkin-group-1').parentElement!;
            expect(grid.style.gridTemplateColumns).toBe('1fr');
        });

        it('keeps the auto-fit grid unchanged when it is not the phone tier', () => {
            renderView({ phoneTier: false });
            const grid = screen.getByTestId('checkin-group-1').parentElement!;
            expect(grid.style.gridTemplateColumns).not.toBe('1fr');
        });

        it('renders a pending racer at least 12px, clearing the issue\'s own floor', () => {
            renderView({ phoneTier: true });
            // `getByText`'s own row match holds the whole "#3 Grace Hopper"
            // row's `fontSize` — jsdom does not compute `rem` against a root
            // font size, so this reads the literal style rather than
            // `getComputedStyle`; `0.95rem` is 15.2px at the default 16px
            // root, well past 12px.
            const row = screen.getByText('Grace Hopper');
            expect(row.style.fontSize).toBe('0.95rem');
        });

        it('lets the view scroll rather than clipping at 100vh', () => {
            renderView({ phoneTier: true });
            const view = screen.getByTestId('checkin-view');
            expect(view.style.height).toBe('auto');
            expect(view.style.overflow).toBe('visible');
        });

        it('still allows overflow scrolling on the desktop tiers, unchanged', () => {
            renderView({ phoneTier: false });
            const view = screen.getByTestId('checkin-view');
            expect(view.style.height).toBe('100vh');
            expect(view.style.overflow).toBe('auto');
        });
    });
});
