import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { RaceExecution } from './RaceExecution';

// Mock Modal component
vi.mock('../Modal', () => ({
    default: ({ isOpen, onClose, children, title }: any) => isOpen ? (
        <div data-testid="mock-modal">
            <h1>{title}</h1>
            <button onClick={onClose}>Close Mock</button>
            {children}
        </div>
    ) : null
}));

describe('RaceExecution', () => {
    const mockHeat = { 
        id: 1, 
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: "Round 1",
        advancementNumRacers: null,
        advancementSource: null,
        totalParticipants: 4, 
        laneResults: JSON.stringify([
            { lane: 1, racerId: 101, racer_id: 101, time: '3.5', place: 1 },
            { lane: 2, racerId: 102, racer_id: 102, time: '3.6', place: 2 }
        ]) 
    };

    const mockRacers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: 'http://example.com/racer101.jpg' },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2 }
    };

    const mockGetRacerName = vi.fn((id: number) => (mockRacers as any)[id] ? `${(mockRacers as any)[id].firstName} ${(mockRacers as any)[id].lastName}` : `Racer ${id}`);
    const mockOnRunHeat = vi.fn();
    const mockOnStartTimer = vi.fn();
    const mockOnNextHeat = vi.fn();
    const mockOnUpdateResult = vi.fn();

    const defaultProps = {
        activeExecutionHeat: mockHeat,
        nextExecutionHeat: null,
        upcomingHeats: [],
        activeHeatId: null,
        onRunHeat: mockOnRunHeat,
        onStartTimer: mockOnStartTimer,
        onNextHeat: mockOnNextHeat,
        getRacerName: mockGetRacerName,
        onUpdateResult: mockOnUpdateResult,
        racers: mockRacers,
        roundSummary: null
    };
    it('renders race execution message if no active heat', () => {
        render(
            <RaceExecution 
                {...defaultProps}
                activeExecutionHeat={null}
            />
        );
        expect(screen.getByText('Race Execution')).toBeInTheDocument();
    });

    it('renders current heat details and racer image', () => {
        render(
            <RaceExecution 
                {...defaultProps}
            />
        );
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('3.5000s')).toBeInTheDocument();
        expect(screen.getByText('1st')).toBeInTheDocument();
        
        // Check for image
        const img = screen.getByAltText('John Doe'); // RacerAvatar uses name as alt
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'http://example.com/racer101.jpg');
    });

    it('shows Edit button when heat is completed', () => {
        render(
            <RaceExecution 
                {...defaultProps}
            />
        );
        expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('opens modal when Edit button is clicked', () => {
        render(
            <RaceExecution 
               {...defaultProps}
            />
        );
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        expect(screen.getByText('Edit Results - Heat 1')).toBeInTheDocument();
    });

    it('calls onUpdateResult when saving edited results', async () => {
        render(
            <RaceExecution 
                {...defaultProps}
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

    const mockActiveHeatRunning = { 
        ...mockHeat,
        laneResults: JSON.stringify([
            { lane: 1, racerId: 101, racer_id: 101, time: null, place: null },
            { lane: 2, racerId: 102, racer_id: 102, time: null, place: null }
        ]) 
    };

    it('renders FakeTimerMole when timerType is FAKE and active heat is running', async () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockActiveHeatRunning}
                activeHeatId={1} // Running
                timerType="FAKE"
            />
        );

        // Should show "Racing..." (now in both main UI and Mole)
        expect(screen.getAllByText(/Racing.../)).toHaveLength(2);
        
        // Mole button should be visible (title "Fake Timer Controls")
        expect(screen.getByText('Fake Timer Controls')).toBeInTheDocument();
    });


    it('finishes heat when FakeTimerMole Finish button is clicked', async () => {
        const user = userEvent.setup();
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockActiveHeatRunning}
                activeHeatId={1} // Running
                timerType="FAKE"
            />
        );
        
        // Click "Finish Heat"
        await user.click(screen.getByText('Finish Heat'));
        
        // Should verify results were saved
        expect(mockOnUpdateResult).toHaveBeenCalledWith(1, expect.any(Array));
    });

    it('does not overwrite results if FakeTimerMole triggers finish on completed heat', async () => {
        // Reset mock
        mockOnUpdateResult.mockClear();

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // This mockHeat is already completed (times are set)
                timerType="FAKE"
            />
        );
        
        // Buttons should be disabled in the mole, but we can also check the logic directly
        // The Mole Finish button should be disabled because isCompleted={true} is passed to it.
        const finishBtn = screen.getByText('Finish Heat');
        expect(finishBtn).toBeDisabled();
        
        // Even if somehow triggered, handleMoleFinish should guard it.
    });

    it('logs start timer event when FakeTimerMole Start button is clicked', async () => {
        const consoleSpy = vi.spyOn(console, 'log');
        const user = userEvent.setup();
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockActiveHeatRunning}
                activeHeatId={null} // Not running yet, so button is enabled
                timerType="FAKE"
            />
        );
        
        // Click "Start Timer"
        await user.click(screen.getByText('Start Timer'));
        
        expect(consoleSpy).toHaveBeenCalledWith('Fake Timer Started via Mole');
        consoleSpy.mockRestore();
    });

    it('renders round summary when provided', () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: true,
            alreadyAdvanced: false,
            advancingRacers: [
                { racerId: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, denName: 'Lions', score: 3.5, rank: 1, isAdvancing: true }
            ],
            source: 'PACK',
            numRacers: 1
        };

        render(
            <RaceExecution 
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );
        
        const modal = screen.getByTestId('mock-modal');
        expect(within(modal).getByText('Round Complete!')).toBeInTheDocument();
        expect(within(modal).getByText(/Top 1 racers advance/)).toBeInTheDocument();
        expect(within(modal).getByText('John Doe')).toBeInTheDocument();
        expect(within(modal).getByText('Lions #1')).toBeInTheDocument();
        expect(within(modal).getByText('3.500')).toBeInTheDocument();
        expect(within(modal).getByText('Start Next Round')).toBeInTheDocument();
    });

    it('renders round summary results even if advancement not required', () => {
        const mockSummaryNoAdvancement = {
            isReady: true,
            requiresAdvancement: false,
            alreadyAdvanced: false,
            advancingRacers: [
                { racerId: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2, denName: 'Tigers', score: 3.6, rank: 2, isAdvancing: false }
            ],
            source: null,
            numRacers: null
        };

        render(
            <RaceExecution 
                {...defaultProps}
                roundSummary={mockSummaryNoAdvancement}
            />
        );
        
        expect(screen.getByText('Round Complete!')).toBeInTheDocument();
        expect(screen.getByText('This round is complete.')).toBeInTheDocument();
        
        // Scope to modal to avoid finding the active heat racer
        const modal = screen.getByTestId('mock-modal');
        expect(within(modal).getByText('Jane Smith')).toBeInTheDocument();
        expect(within(modal).getByText('3.600')).toBeInTheDocument();
    });

    it('renders upcoming heats list', () => {
        const upcoming = [
            { 
                id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, roundName: 'Round 1',
                advancementNumRacers: null, advancementSource: null, totalParticipants: 4,
                laneResults: JSON.stringify([{ lane: 1, racerId: 103, racer_id: 103, time: null }])
            }
        ];
        
        render(
            <RaceExecution 
                 {...defaultProps}
                 upcomingHeats={upcoming}
            />
        );
        
        expect(screen.getByText('Upcoming')).toBeInTheDocument();
        expect(screen.getByText('Heat 2')).toBeInTheDocument();
        expect(screen.getAllByText('Round 1')[1]).toBeInTheDocument(); // One in active, one in upcoming
    });

    it('closes modal when close button is clicked', async () => {
        const mockSummary = {
            isReady: true,
            requiresAdvancement: false,
            alreadyAdvanced: false,
            advancingRacers: [],
            source: null,
            numRacers: null
        };

        render(
            <RaceExecution 
                {...defaultProps}
                roundSummary={mockSummary}
            />
        );
        
        // Modal should be open initially
        expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
        
        // Find and click close button
        const closeBtn = screen.getByText('Close Mock');
        fireEvent.click(closeBtn);
        
        // Modal should be gone
        await waitFor(() => {
            expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument();
        });
    });
});
