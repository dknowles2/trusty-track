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
        timerType: 'FAKE'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        
        mockMutationFn.mockResolvedValue({ data: { prepareHeat: true } });
        (useMutation as any).mockReturnValue([{}, mockMutationFn]);

        (useSubscription as any).mockImplementation(({ query }: any) => {
            const qStr = JSON.stringify(query);
            if (qStr.includes('TimerStatus')) {
                return [{ data: { timerStatus: { state: 'IDLE' } } }];
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
                return [{ data: { timerStatus: { state: 'RUNNING' } } }];
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

    it('shows "Prepare Heat" button when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: null, place: null }])
                }}
            />
        );

        expect(screen.getByText('Prepare Heat')).toBeInTheDocument();
    });

    it('calls prepareHeat mutation when Prepare Heat button is clicked', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: null, place: null }])
                }}
            />
        );

        fireEvent.click(screen.getByText('Prepare Heat'));
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
});
