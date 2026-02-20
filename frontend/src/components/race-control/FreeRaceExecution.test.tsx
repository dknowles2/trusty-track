import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation } from 'urql';
import { FreeRaceExecution } from './FreeRaceExecution';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
  };
});

vi.mock('../Modal', () => ({
  default: ({ isOpen, onClose, children, title }: any) =>
    isOpen ? (
      <div data-testid="mock-modal">
        <h2>{title}</h2>
        <button onClick={onClose}>Close Mock</button>
        {children}
      </div>
    ) : null,
}));

// Suppress FakeTimerMole auto-finish timer in tests
vi.mock('./FakeTimerMole', () => ({
  FakeTimerMole: ({ isOpen, onTriggerFinish, onTriggerStart, isRunning, isCompleted }: any) =>
    isOpen ? (
      <div data-testid="fake-timer-mole">
        <button
          onClick={onTriggerStart}
          disabled={isCompleted || isRunning}
          data-testid="start-timer-btn"
        >
          Start Timer
        </button>
        <button
          onClick={() =>
            onTriggerFinish([
              { lane: 1, racer_id: 101, time: 3.142, place: 1 },
              { lane: 2, racer_id: 102, time: 3.500, place: 2 },
            ])
          }
          disabled={isCompleted || !isRunning}
          data-testid="finish-heat-btn"
        >
          Finish Heat
        </button>
      </div>
    ) : null,
}));

const mockLaneAssignments = [
  { lane: 1, racerId: 101 },
  { lane: 2, racerId: 102 },
  { lane: 3, racerId: null },
];

const mockRacers = {
  101: { id: 101, firstName: 'Alice', lastName: 'Smith', carNumber: 7 },
  102: { id: 102, firstName: 'Bob', lastName: 'Jones', carNumber: 12 },
};

describe('FreeRaceExecution', () => {
  const mockOnRunAnother = vi.fn();
  const mockRecordResult = vi.fn();

  const defaultProps = {
    heatId: 42,
    laneAssignments: mockLaneAssignments,
    racers: mockRacers,
    timerType: 'FAKE',
    onRunAnother: mockOnRunAnother,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordResult.mockResolvedValue({
      data: {
        recordFreeRaceResult: {
          id: 42,
          laneResults: JSON.stringify([
            { lane: 1, racer_id: 101, time: 3.142, place: 1 },
            { lane: 2, racer_id: 102, time: 3.5, place: 2 },
            { lane: 3, racer_id: null, time: null, place: null },
          ]),
        },
      },
    });
    (useMutation as any).mockReturnValue([{}, mockRecordResult]);
  });

  it('renders lane assignments with racer names', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('renders empty lanes as (empty)', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('shows "Waiting for timer..." before results are recorded', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('Waiting for timer...')).toBeInTheDocument();
  });

  it('shows the FakeTimerMole when timerType is FAKE', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByTestId('fake-timer-mole')).toBeInTheDocument();
  });

  it('does not show FakeTimerMole when timerType is not FAKE', () => {
    render(<FreeRaceExecution {...defaultProps} timerType={null} />);
    expect(screen.queryByTestId('fake-timer-mole')).not.toBeInTheDocument();
  });

  it('calls recordFreeRaceResult mutation when fake timer fires', async () => {
    render(<FreeRaceExecution {...defaultProps} />);

    // Start the timer first
    fireEvent.click(screen.getByTestId('start-timer-btn'));
    // Now finish
    fireEvent.click(screen.getByTestId('finish-heat-btn'));

    await waitFor(() => {
      expect(mockRecordResult).toHaveBeenCalledWith(
        expect.objectContaining({ heatId: 42 })
      );
    });
  });

  it('displays results (time, place) after mutation succeeds', async () => {
    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByTestId('start-timer-btn'));
    fireEvent.click(screen.getByTestId('finish-heat-btn'));

    await waitFor(() => {
      expect(screen.getByText('3.1420s')).toBeInTheDocument();
      expect(screen.getByText('🥇')).toBeInTheDocument();
      expect(screen.getByText('🥈')).toBeInTheDocument();
    });
  });

  it('"Run Another" button appears after results are saved and calls onRunAnother', async () => {
    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByTestId('start-timer-btn'));
    fireEvent.click(screen.getByTestId('finish-heat-btn'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run Another/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Run Another/i }));
    expect(mockOnRunAnother).toHaveBeenCalledOnce();
  });

  it('Edit Results button opens modal after heat is completed', async () => {
    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByTestId('start-timer-btn'));
    fireEvent.click(screen.getByTestId('finish-heat-btn'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
  });

  it('Edit modal allows saving corrected times and calls mutation again', async () => {
    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByTestId('start-timer-btn'));
    fireEvent.click(screen.getByTestId('finish-heat-btn'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));

    // Change lane 1 time
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3.999' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Results/i }));

    await waitFor(() => {
      expect(mockRecordResult).toHaveBeenCalledTimes(2);
    });
  });

  it('warning badge "results do not affect standings" is always visible', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText(/results do not affect standings/i)).toBeInTheDocument();
  });
});
