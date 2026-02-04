import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { ScheduleManagement } from './ScheduleManagement';

describe('ScheduleManagement', () => {
    const mockHeats = [
        { id: 1, round_number: 1, round_id: 1, heat_number: 1, lane_results: '[]' },
        { id: 2, round_number: 1, round_id: 1, heat_number: 2, lane_results: '[]' }
    ];
    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnAddRound = vi.fn();
    const mockOnRegenerateRound = vi.fn();
    const mockOnRunHeat = vi.fn();

    it('renders the add round button', () => {
        render(
            <ScheduleManagement 
                raceId={1}
                heats={[]} 
                generating={false} 
                activeHeatId={null}
                onAddRound={mockOnAddRound}
                onRegenerateRound={mockOnRegenerateRound}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        expect(screen.getByText('Add Round')).toBeInTheDocument();
    });

    it('displays heats grouped by round', () => {
        render(
            <ScheduleManagement 
                raceId={1}
                heats={mockHeats} 
                generating={false} 
                activeHeatId={null}
                onAddRound={mockOnAddRound}
                onRegenerateRound={mockOnRegenerateRound}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        expect(screen.getByText('1 Round')).toBeInTheDocument();
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('Heat 2')).toBeInTheDocument();
    });

    it('opens modal when add round button is clicked', () => {
        render(
            <ScheduleManagement 
                raceId={1}
                heats={[]} 
                generating={false} 
                activeHeatId={null}
                onAddRound={mockOnAddRound}
                onRegenerateRound={mockOnRegenerateRound}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        fireEvent.click(screen.getByText('Add Round'));
        // Modal should open - check for modal content
        expect(screen.getByText('Scheduling Strategy')).toBeInTheDocument();
    });

    it('calls onRunHeat when run button is clicked', () => {
        render(
            <ScheduleManagement 
                raceId={1}
                heats={mockHeats} 
                generating={false} 
                activeHeatId={null}
                onAddRound={mockOnAddRound}
                onRegenerateRound={mockOnRegenerateRound}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        const runButtons = screen.getAllByText('Run');
        fireEvent.click(runButtons[0]);
        expect(mockOnRunHeat).toHaveBeenCalled();
    });
});
