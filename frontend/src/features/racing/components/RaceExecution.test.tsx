import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useSubscription } from 'urql';
import { RaceExecution, Heat } from './RaceExecution';
import { lane } from '../testFixtures';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

// Mock Modal component
vi.mock('../../../components/ui/Modal', () => ({
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
    // `time` arrives as a string in `laneResults` on purpose — real databases
    // hold both — while `lanes` reports it as the number it always was.
    const mockHeat: Heat = {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: "Round 1",
        lanes: [
            lane({ lane: 1, racerId: 101, time: 3.5, place: 1 }),
            lane({ lane: 2, racerId: 102, time: 3.6, place: 2 }),
        ],
    };

    // Shaped to match what the GetRaceControlData query actually returns —
    // every selected field is present, nullable ones explicitly null.
    const mockRacers = {
        101: { id: 101, firstName: 'John', lastName: 'Doe', carNumber: 1, racerImageUrl: 'http://example.com/racer101.jpg', carImageUrl: null },
        102: { id: 102, firstName: 'Jane', lastName: 'Smith', carNumber: 2, racerImageUrl: null, carImageUrl: null }
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

        mockHeatSession(null);
    });

    /**
     * Stand in for the `heatSession` subscription.
     *
     * `null` means it has not answered yet, which is the state of the very
     * first render — the component falls back to the heat's stored lanes, and
     * most tests here are about that saved state rather than about a heat in
     * progress.
     */
    function mockHeatSession(session: any) {
        (useSubscription as any).mockImplementation(({ query }: any) => {
            if (JSON.stringify(query).includes('HeatSession')) {
                return [{ data: { heatSession: session } }];
            }
            return [{ data: null }];
        });
    }

    const liveLane = (overrides: any) => ({ ...lane(overrides), pending: false, ...overrides });

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
            // A number, not the '4.0' the blob used to carry (#5).
            expect(args[1][0].time).toBe(4);
        });
    });

    it('renders "Racing..." when timer state is RUNNING', () => {
        mockHeatSession({
            trackId: 1,
            heatId: 1,
            phase: 'RUNNING',
            timerState: 'RUNNING',
            lanes: [liveLane({ lane: 1, racerId: 101 })],
        });

        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    lanes: [lane({ lane: 1, racerId: 101 })],
                }}
            />
        );

        expect(screen.getByText(/Racing.../)).toBeInTheDocument();
    });

    describe('the live view comes from the server (#7)', () => {
        it('shows a lane time the timer has reported but nothing has saved', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RUNNING',
                timerState: 'RUNNING',
                lanes: [
                    liveLane({ lane: 1, racerId: 101, time: 3.101, place: 1, pending: true }),
                    liveLane({ lane: 2, racerId: 102 }),
                ],
            });

            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{
                        ...mockHeat,
                        lanes: [
                            lane({ lane: 1, racerId: 101 }),
                            lane({ lane: 2, racerId: 102 }),
                        ],
                    }}
                />
            );

            // The heat itself holds no times — this one exists only in the timer.
            expect(screen.getByText('3.1010s')).toBeInTheDocument();
            expect(screen.getByText('--')).toBeInTheDocument();
        });

        it('shows the saved results, not a timer that has not caught up', () => {
            // The expensive one to get wrong: the heat is recorded and in the
            // standings, so a stale pending report must not appear over it.
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'RUNNING',
                lanes: [
                    liveLane({ lane: 1, racerId: 101, time: 3.5, place: 1 }),
                    liveLane({ lane: 2, racerId: 102, time: 3.6, place: 2 }),
                ],
            });

            render(<RaceExecution {...defaultProps} />);

            expect(screen.getByText('3.5000s')).toBeInTheDocument();
            expect(screen.queryByText(/Racing.../)).not.toBeInTheDocument();
            expect(screen.getByText('Edit')).toBeInTheDocument();
        });

        it('believes the phase over its own copy of the heat', () => {
            // The session arrives on its own channel, so it can be ahead: the
            // timer has saved a result and `heatSession` says RECORDED while
            // `activeExecutionHeat` still holds the pre-race lanes from the
            // last query. Deriving "completed" locally would leave the operator
            // staring at "Waiting for Timer..." over a heat that has finished.
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'RECORDED',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: 101, time: 3.5, place: 1 })],
            });

            render(
                <RaceExecution
                    {...defaultProps}
                    activeExecutionHeat={{
                        ...mockHeat,
                        lanes: [lane({ lane: 1, racerId: 101 })],
                    }}
                />
            );

            expect(screen.getByText('Edit')).toBeInTheDocument();
            expect(screen.queryByText('Waiting for Timer...')).not.toBeInTheDocument();
        });

        it('treats a NOT_READY phase as a championship round awaiting its field', () => {
            mockHeatSession({
                trackId: 1,
                heatId: 1,
                phase: 'NOT_READY',
                timerState: 'IDLE',
                lanes: [liveLane({ lane: 1, racerId: null, placeholderSlot: 1 })],
            });

            render(<RaceExecution {...defaultProps} />);

            expect(screen.getByText('Round Not Ready')).toBeInTheDocument();
        });
    });

    it('shows "Waiting for Timer..." message when IDLE and not completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={{
                    ...mockHeat,
                    lanes: [lane({ lane: 1, racerId: 101 })],
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
                    lanes: [lane({ lane: 1, racerId: 101 })],
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
            lanes: [lane({ lane: 1, placeholderSlot: 1 })],
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

    it('does NOT call prepareHeat if heat is already completed', () => {
        render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();
    });

    it('calls prepareHeat when heatId changes to a new, uncompleted heat', () => {
        const { rerender } = render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();

        const uncompletedHeat: Heat = {
            ...mockHeat,
            id: 2,
            heatNumber: 2,
            lanes: [lane({ lane: 1, racerId: 101 })]
        };

        rerender(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={uncompletedHeat}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 2 });
    });

    it('calls prepareHeat when results are cleared (re-run) for the same heatId', () => {
        const { rerender } = render(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={mockHeat} // mockHeat is completed
            />
        );

        expect(mockMutationFn).not.toHaveBeenCalled();

        const clearedHeat: Heat = {
            ...mockHeat,
            lanes: [lane({ lane: 1, racerId: 101 })]
        };

        rerender(
            <RaceExecution
                {...defaultProps}
                activeExecutionHeat={clearedHeat}
            />
        );

        expect(mockMutationFn).toHaveBeenCalledWith({ heatId: 1 });
    });
});
