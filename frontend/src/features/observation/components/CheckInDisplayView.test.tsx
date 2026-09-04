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
});
