import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import RaceFinishedOverlay from './RaceFinishedOverlay';

const standings = [
    { racerId: 1, rank: 1, firstName: 'Dot', lastName: 'Power', carNumber: 103, score: 3.1 },
    { racerId: 2, rank: 2, firstName: 'Uma', lastName: 'Spark', carNumber: 104, score: 3.2 },
];

describe('RaceFinishedOverlay', () => {
    it('says the race is complete', () => {
        render(
            <RaceFinishedOverlay
                roundLabel={null}
                standings={standings}
                formatScore={(s) => s.toFixed(3)}
                scoreLabel="Average Time"
                nameDisplay="FULL"
                vehicle="Car"
            />,
        );

        expect(screen.getByText('Race complete!')).toBeInTheDocument();
    });

    // #869 — a chained final's own result, not the qualifying standings, is
    // what the room is watching for.
    it('names the championship round when its placings are what is shown', () => {
        render(
            <RaceFinishedOverlay
                roundLabel="Grand Finals"
                standings={standings}
                formatScore={(s) => s.toFixed(3)}
                scoreLabel="Average Time"
                nameDisplay="FULL"
                vehicle="Car"
            />,
        );

        expect(screen.getByText('Grand Finals results')).toBeInTheDocument();
    });

    it('falls back to the overall standings label when there is no championship round', () => {
        render(
            <RaceFinishedOverlay
                roundLabel={null}
                standings={standings}
                formatScore={(s) => s.toFixed(3)}
                scoreLabel="Average Time"
                nameDisplay="FULL"
                vehicle="Car"
            />,
        );

        expect(screen.getByText('Final standings')).toBeInTheDocument();
    });

    it('lists the top standings with their car numbers', () => {
        render(
            <RaceFinishedOverlay
                roundLabel="Grand Finals"
                standings={standings}
                formatScore={(s) => s.toFixed(3)}
                scoreLabel="Average Time"
                nameDisplay="FULL"
                vehicle="Car"
            />,
        );

        expect(screen.getByText('Dot Power')).toBeInTheDocument();
        expect(screen.getByText('Car #103')).toBeInTheDocument();
        expect(screen.getByText('Uma Spark')).toBeInTheDocument();
    });

    it('abbreviates a name under the resolved setting (#552)', () => {
        render(
            <RaceFinishedOverlay
                roundLabel={null}
                standings={standings}
                formatScore={(s) => s.toFixed(3)}
                scoreLabel="Average Time"
                nameDisplay="LAST_INITIAL"
                vehicle="Car"
            />,
        );

        expect(screen.getByText('Dot P.')).toBeInTheDocument();
    });
});
