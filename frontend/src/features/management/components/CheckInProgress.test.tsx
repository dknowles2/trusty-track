import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import CheckInProgress from './CheckInProgress';

describe('CheckInProgress', () => {
    it('answers "can we start yet" with a count', () => {
        render(<CheckInProgress checkedIn={43} registered={60} />);

        expect(screen.getByText('43 of 60 checked in')).toBeInTheDocument();
    });

    it('says nothing on a race with nobody on it', () => {
        // "0 of 0 checked in" reads as a problem on a race that has simply not
        // been filled in yet, and the setup checklist already covers that.
        render(<CheckInProgress checkedIn={0} registered={0} />);

        expect(screen.queryByTestId('check-in-progress')).not.toBeInTheDocument();
    });

    it('still reports a roster nobody has started on', () => {
        render(<CheckInProgress checkedIn={0} registered={12} />);

        expect(screen.getByText('0 of 12 checked in')).toBeInTheDocument();
    });

    it('reports a finished check-in', () => {
        render(<CheckInProgress checkedIn={12} registered={12} />);

        expect(screen.getByText('12 of 12 checked in')).toBeInTheDocument();
    });
});
