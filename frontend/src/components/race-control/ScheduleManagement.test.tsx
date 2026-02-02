import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { ScheduleManagement } from './ScheduleManagement';

describe('ScheduleManagement', () => {
    const mockHeats = [
        { id: 1, round_number: 1, heat_number: 1, lane_results: '[]' },
        { id: 2, round_number: 1, heat_number: 2, lane_results: '[]' }
    ];
    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnGenerate = vi.fn();
    const mockOnRunHeat = vi.fn();

    it('renders the generate button', () => {
        render(
            <ScheduleManagement 
                heats={[]} 
                generating={false} 
                activeHeatId={null}
                onGenerate={mockOnGenerate}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        expect(screen.getByText('Regenerate Schedule')).toBeInTheDocument();
    });

    it('displays heats grouped by round', () => {
        render(
            <ScheduleManagement 
                heats={mockHeats} 
                generating={false} 
                activeHeatId={null}
                onGenerate={mockOnGenerate}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        expect(screen.getByText('Round 1')).toBeInTheDocument();
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('Heat 2')).toBeInTheDocument();
    });

    it('calls onGenerate when regenerate button is clicked', () => {
        render(
            <ScheduleManagement 
                heats={[]} 
                generating={false} 
                activeHeatId={null}
                onGenerate={mockOnGenerate}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        fireEvent.click(screen.getByText('Regenerate Schedule'));
        expect(mockOnGenerate).toHaveBeenCalled();
    });

    it('calls onRunHeat when run button is clicked', () => {
        render(
            <ScheduleManagement 
                heats={mockHeats} 
                generating={false} 
                activeHeatId={null}
                onGenerate={mockOnGenerate}
                onRunHeat={mockOnRunHeat}
                getRacerName={mockGetRacerName}
            />
        );
        const runButtons = screen.getAllByText('Run');
        fireEvent.click(runButtons[0]);
        expect(mockOnRunHeat).toHaveBeenCalledWith(mockHeats[0]);
    });
});
