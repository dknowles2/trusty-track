import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { RaceExecution } from './RaceExecution';

// Mock Modal component
vi.mock('../Modal', () => ({
    default: ({ isOpen, children, title }: any) => isOpen ? (
        <div data-testid="mock-modal">
            <h1>{title}</h1>
            {children}
        </div>
    ) : null
}));

describe('RaceExecution', () => {
    const mockHeat = { 
        id: 1, 
        round_number: 1,
        round_id: 1,
        heat_number: 1, 
        lane_results: JSON.stringify([
            { lane: 1, racer_id: 101, time: '3.5', place: 1 },
            { lane: 2, racer_id: 102, time: '3.6', place: 2 }
        ]) 
    };

    // const mockNextHeat = {
    //     id: 2,
    //     round_number: 1,
    //     heat_number: 2,
    //     lane_results: '[]'
    // };

    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnRunHeat = vi.fn();
    const mockOnStartTimer = vi.fn();
    const mockOnNextHeat = vi.fn();
    const mockOnUpdateResult = vi.fn();

    it('renders race complete message if no active heat', () => {
        render(
            <RaceExecution 
                activeExecutionHeat={null}
                nextExecutionHeat={null}
                activeHeatId={null}
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
            />
        );
        expect(screen.getByText('Race Complete!')).toBeInTheDocument();
    });

    it('renders current heat details', () => {
        render(
            <RaceExecution 
                activeExecutionHeat={mockHeat}
                nextExecutionHeat={null}
                activeHeatId={null}
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
            />
        );
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('Racer 101')).toBeInTheDocument();
        expect(screen.getByText('3.5s')).toBeInTheDocument();
    });

    it('shows Edit button when heat is completed', () => {
        render(
            <RaceExecution 
                activeExecutionHeat={mockHeat}
                nextExecutionHeat={null}
                activeHeatId={null}
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
            />
        );
        expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('opens modal when Edit button is clicked', () => {
        render(
            <RaceExecution 
                activeExecutionHeat={mockHeat}
                nextExecutionHeat={null}
                activeHeatId={null}
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
            />
        );
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
    });

    it('calls onUpdateResult when saving edited results', async () => {
        render(
            <RaceExecution 
                activeExecutionHeat={mockHeat}
                nextExecutionHeat={null}
                activeHeatId={null}
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
            />
        );
        fireEvent.click(screen.getByText('Edit'));
        
        const inputs = screen.getAllByRole('spinbutton'); // number inputs
        fireEvent.change(inputs[0], { target: { value: '4.0' } });
        
        fireEvent.click(screen.getByText('Save Results'));
        
        await waitFor(() => {
            expect(mockOnUpdateResult).toHaveBeenCalled();
            // Verify arguments - should be heatId and updated results array
            const args = mockOnUpdateResult.mock.calls[0];
            expect(args[0]).toBe(1);
            expect(args[1][0].time).toBe('4.0');
        });
    });

    const mockActiveHeat = { 
        id: 1, 
        round_number: 1,
        round_id: 1,
        heat_number: 1, 
        lane_results: JSON.stringify([
            { lane: 1, racer_id: 101, time: null, place: null },
            { lane: 2, racer_id: 102, time: null, place: null }
        ]) 
    };

    const mockNextHeat = null;

    it('renders FakeTimerMole when timerType is FAKE and active heat is running', async () => {
        render(
            <RaceExecution
                activeExecutionHeat={mockActiveHeat}
                nextExecutionHeat={mockNextHeat}
                activeHeatId={1} // Running
                onRunHeat={mockOnRunHeat}
                onStartTimer={mockOnStartTimer}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
                timerType="FAKE"
            />
        );

        // Should show "Racing..." 
        expect(screen.getByText(/Racing.../)).toBeInTheDocument();
        
        // Mole button should be visible (title "Fake Timer Controls")
        expect(screen.getByText('Fake Timer Controls')).toBeInTheDocument();
    });


    it('finishes heat when FakeTimerMole Finish button is clicked', async () => {
        const user = userEvent.setup();
        render(
            <RaceExecution
                activeExecutionHeat={mockActiveHeat}
                nextExecutionHeat={mockNextHeat}
                activeHeatId={1} // Running
                onRunHeat={mockOnRunHeat}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
                onStartTimer={mockOnStartTimer}
                timerType="FAKE"
            />
        );


        
        // Click "Finish Heat"
        await user.click(screen.getByText('Finish Heat'));
        
        // Should verify results were saved
        expect(mockOnUpdateResult).toHaveBeenCalledWith(1, expect.any(Array));
    });

    it('logs start timer event when FakeTimerMole Start button is clicked', async () => {
        const consoleSpy = vi.spyOn(console, 'log');
        const user = userEvent.setup();
        render(
            <RaceExecution
                activeExecutionHeat={mockActiveHeat}
                nextExecutionHeat={mockNextHeat}
                activeHeatId={1} // Running
                onRunHeat={mockOnRunHeat}
                onNextHeat={mockOnNextHeat}
                getRacerName={mockGetRacerName}
                onUpdateResult={mockOnUpdateResult}
                onStartTimer={mockOnStartTimer}
                timerType="FAKE"
            />
        );


        
        // Click "Start Timer"
        await user.click(screen.getByText('Start Timer'));
        
        expect(consoleSpy).toHaveBeenCalledWith('Fake Timer Started via Mole');
        consoleSpy.mockRestore();
    });
});
