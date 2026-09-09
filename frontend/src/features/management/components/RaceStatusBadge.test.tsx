// @vitest-environment jsdom
import '../../../setupTests';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RaceStatusBadge from './RaceStatusBadge';

describe('RaceStatusBadge', () => {
    it('says Not started', () => {
        render(<RaceStatusBadge status="NOT_STARTED" />);
        expect(screen.getByText('Not started')).toBeInTheDocument();
    });

    it('says In progress', () => {
        render(<RaceStatusBadge status="IN_PROGRESS" />);
        expect(screen.getByText('In progress')).toBeInTheDocument();
    });

    it('says Finished', () => {
        render(<RaceStatusBadge status="FINISHED" />);
        expect(screen.getByText('Finished')).toBeInTheDocument();
    });

    it('names what it means, for anyone hovering it', () => {
        render(<RaceStatusBadge status="IN_PROGRESS" />);
        expect(
            screen.getByTitle("This race's schedule is in progress")
        ).toBeInTheDocument();
    });
});
