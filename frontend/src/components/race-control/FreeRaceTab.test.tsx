import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation } from 'urql';
import { FreeRaceTab } from './FreeRaceTab';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
  };
});

// Stub child components so tests stay focused on FreeRaceTab's phase logic
vi.mock('./FreeRaceLaneSetup', () => ({
  FreeRaceLaneSetup: ({ onStart }: any) => (
    <div data-testid="free-race-lane-setup">
      <button
        onClick={() => onStart([{ lane: 1, racerId: 101 }, { lane: 2, racerId: 102 }])}
      >
        Start Heat
      </button>
    </div>
  ),
}));

vi.mock('./FreeRaceExecution', () => ({
  FreeRaceExecution: ({ heatId, onRunAnother }: any) => (
    <div data-testid="free-race-execution">
      <span data-testid="heat-id">{heatId}</span>
      <button onClick={onRunAnother}>Run Another</button>
    </div>
  ),
}));

describe('FreeRaceTab', () => {
  const mockStartMutation = vi.fn();

  const defaultProps = {
    raceId: 1,
    laneCount: 4,
    timerType: 'FAKE',
    racers: {
      101: { id: 101, firstName: 'Alice', lastName: 'Smith', carNumber: 7 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartMutation.mockResolvedValue({
      data: { startFreeRaceHeat: { id: 99, laneAssignments: '[]' } },
    });
    (useMutation as any).mockReturnValue([{}, mockStartMutation]);
  });

  it('renders FreeRaceLaneSetup in the setup phase initially', () => {
    render(<FreeRaceTab {...defaultProps} />);
    expect(screen.getByTestId('free-race-lane-setup')).toBeInTheDocument();
    expect(screen.queryByTestId('free-race-execution')).not.toBeInTheDocument();
  });

  it('calls startFreeRaceHeat mutation when onStart fires', async () => {
    render(<FreeRaceTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Heat/i }));
    await waitFor(() => {
      expect(mockStartMutation).toHaveBeenCalledWith(
        expect.objectContaining({ raceId: 1 })
      );
    });
  });

  it('transitions to FreeRaceExecution after mutation succeeds', async () => {
    render(<FreeRaceTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Heat/i }));
    await waitFor(() => {
      expect(screen.getByTestId('free-race-execution')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('free-race-lane-setup')).not.toBeInTheDocument();
    // The heat ID returned by the mutation is passed down
    expect(screen.getByTestId('heat-id')).toHaveTextContent('99');
  });

  it('transitions back to FreeRaceLaneSetup when onRunAnother fires', async () => {
    render(<FreeRaceTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Heat/i }));
    await waitFor(() => {
      expect(screen.getByTestId('free-race-execution')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Another/i }));
    await waitFor(() => {
      expect(screen.getByTestId('free-race-lane-setup')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('free-race-execution')).not.toBeInTheDocument();
  });

  it('shows an error message when startFreeRaceHeat mutation fails', async () => {
    mockStartMutation.mockResolvedValue({
      error: { message: 'Server error' },
    });
    render(<FreeRaceTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Heat/i }));
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
    // Should stay on setup phase
    expect(screen.getByTestId('free-race-lane-setup')).toBeInTheDocument();
  });
});
