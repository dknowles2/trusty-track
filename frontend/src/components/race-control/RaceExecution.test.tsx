import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useSubscription } from 'urql';
import { RaceExecution, Heat } from './RaceExecution';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

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

// Mock FakeTimerMole
vi.mock('./FakeTimerMole', () => ({
  FakeTimerMole: ({ isOpen }: any) =>
    isOpen ? (
      <div data-testid="fake-timer-mole">
        Fake Timer Controls
      </div>
    ) : null,
}));

describe('RaceExecution', () => {
    const mockHeat: Heat = { 
        id: 1, 
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: "Round 1",
        laneResults: JSON.stringify([
            { lane: 1, racer_id: 101, time: '3.5', place: 1 },
            { lane: 2, racer_id: 102, time: '3.6', place: 2 }
        ]) 
    };

    const mockRacers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: 'http://example.com/racer101.jpg' },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2 }
    };

    const mockGetRacerName = vi.fn((id: number) => (mockRacers as any)[id] ? `${(mockRacers as any)[id].firstName} ${(mockRacers as any)[id].lastName}` : `Racer ${id}`);
    const mockOnRunHeat = vi.fn();
    const mockOnNextHeat = vi.fn();
    const mockOnUpdateResult = vi.fn();
    const mockMutationFn = vi.fn();

    const defaultProps = {
        activeExecutionHeat: mockHeat,
        nextExecutionHeat: null,
        upcomingHeats: [],
        activeHeatId: null,
        onRunHeat: mockOnRunHeat,
        onNextHeat: mockOnNextHeat,
        getRacerName: mockGetRacerName,
        onUpdateResult: mockOnUpdateResult,
        racers: mockRacers,
        roundSummary: null,
        trackId: 1,
        timerType: 'FAKE',
        autoAdvanceHeat: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockMutationFn.mockResolvedValue({ data: { prepareHeat: true } });
        (useMutation as any).mockReturnValue([{}, mockMutationFn]);

        (useSubscription as any).mockImplementation(({ query }: any) => {
            const qStr = JSON.stringify(query);
            if (qStr.includes('TimerStatus')) {
                return [{ data: { timerStatus: { status: { state: 'IDLE' } } } }];
            }
            return [{ data: null }];
        });
    });

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
        
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '4.0' } });
        
        fireEvent.click(screen.getByText('Save Results'));
        
        await waitFor(() => {
            expect(mockOnUpdateResult).toHaveBeenCalled();
            const args = mockOnUpdateResult.mock.calls[0];
            expect(args[0]).toBe(1);
            expect(args[1][0].time).toBe('4.0');
        });
    });

    it('renders "Racing..." when timer state is RUNNING', () => {
        (useSubscription as any).mockImplementation(({ query }: any) => {
            const qStr = JSON.stringify(query);
            if (qStr.includes('TimerStatus')) {
                return [{ data: { timerStatus: { status: { state: 'RUNNING' } } } }];
            }
            return [{ data: null }];
        });

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: null, place: null }])
                }}
            />
        );

        expect(screen.getByText(/Racing.../)).toBeInTheDocument();
    });

    it('shows "Waiting for Timer..." message when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: null, place: null }])
                }}
            />
        );

        expect(screen.getByText('Waiting for Timer...')).toBeInTheDocument();
    });

    it('calls prepareHeat mutation automatically when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: null, place: null }])
                }}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 1 });
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
    });

    it('renders round progress and remaining heats correctly', () => {
        render(
            <RaceExecution 
                {...defaultProps}
                nextExecutionHeat={{ ...mockHeat, id: 2, heatNumber: 2 }}
                totalHeatsInRound={10}
                remainingHeatsInRound={4}
            />
        );
        
        expect(screen.getByText('Round Progress')).toBeInTheDocument();
        expect(screen.getByText('6 of 10 Heats Completed')).toBeInTheDocument();
        expect(screen.getByText('4 Heats Remaining')).toBeInTheDocument();
    });

    it('renders upcoming rounds when provided', () => {
        const mockUpcomingRounds = [
            { roundNumber: 2, roundName: "Finals", totalHeats: 1 }
        ];
        render(
            <RaceExecution 
                {...defaultProps}
                upcomingRounds={mockUpcomingRounds}
            />
        );
        
        expect(screen.getByText('Upcoming Rounds')).toBeInTheDocument();
        expect(screen.getByText('Finals')).toBeInTheDocument();
        expect(screen.getByText('1 Heat Scheduled')).toBeInTheDocument();
    });

    it('shows "End of Round" in On Deck when next heat is in a different round', () => {
        render(
            <RaceExecution 
                {...defaultProps}
                activeExecutionHeat={{ ...mockHeat, roundId: 1 }}
                nextExecutionHeat={{ ...mockHeat, id: 2, heatNumber: 1, roundId: 2, roundNumber: 2, roundName: null }}
            />
        );
        
        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText(/Next: Round 2/)).toBeInTheDocument();
    });

    it('renders "Round Not Ready" when heat has placeholders', () => {
        const placeholderHeat: Heat = {
            id: 2,
            roundNumber: 2,
            roundId: 2,
            heatNumber: 1,
            roundName: "Finals",
            laneResults: JSON.stringify([
                { lane: 1, racer_id: -1, time: null, place: null }
            ])
        };

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={placeholderHeat}
            />
        );

        expect(screen.getByText('Round Not Ready')).toBeInTheDocument();
        expect(screen.getByText(/The racers for/)).toBeInTheDocument();
        expect(screen.getByText('Finals')).toBeInTheDocument();
        // Should NOT call prepareHeat
        expect(mockMutationFn).not.toHaveBeenCalled();
    });
});
