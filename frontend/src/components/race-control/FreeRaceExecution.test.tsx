import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useSubscription } from 'urql';
import { FreeRaceExecution } from './FreeRaceExecution';

vi.mock('../../context/AlertContext', () => ({
  useAlert: () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn(),
    showToast: vi.fn(),
  }),
}));

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
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

vi.mock('./FakeTimerMole', () => ({
  FakeTimerMole: ({ isOpen }: any) =>
    isOpen ? (
      <div data-testid="fake-timer-mole">
        Fake Timer Mole Active
      </div>
    ) : null,
}));

const mockLaneAssignments = [
  { id: '1', lane: 1, racerId: 101 },
  { id: '2', lane: 2, racerId: 102 },
  { id: '3', lane: 3, racerId: null },
];

const mockRacers = {
  101: { id: 101, firstName: 'Alice', lastName: 'Smith', carNumber: 7 },
  102: { id: 102, firstName: 'Bob', lastName: 'Jones', carNumber: 12 },
};

describe('FreeRaceExecution', () => {
  const mockOnRunAnother = vi.fn();
  const mockRecordResult = vi.fn();
  const mockPrepareHeat = vi.fn();

  const defaultProps = {
    heatId: 42,
    laneAssignments: mockLaneAssignments,
    racers: mockRacers,
    timerType: 'FAKE',
    onRunAnother: mockOnRunAnother,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockPrepareHeat.mockResolvedValue({ data: { prepareHeat: true } });
    
    (useMutation as any).mockImplementation((query: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('RecordFreeRaceResult')) return [{}, mockRecordResult];
      if (qStr.includes('PrepareHeat')) return [{}, mockPrepareHeat];
      return [{}, vi.fn()];
    });

    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('TimerStatus')) {
        return [{ data: { timerStatus: { status: { state: 'IDLE' } } } }];
      }
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: null } }];
      }
      return [{}];
    });
  });

  it('renders lane assignments with racer names', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('auto-calls prepareHeat mutation on mount if IDLE', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(mockPrepareHeat).toHaveBeenCalledWith({ heatId: 42 });
  });

  it('shows "Waiting for timer..." before results are recorded', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('Waiting for Timer...')).toBeInTheDocument();
  });

  it('shows "Racing..." when timer state is RUNNING', () => {
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('TimerStatus')) {
        return [{ data: { timerStatus: { status: { state: 'RUNNING' } } } }];
      }
      return [{ data: null }];
    });
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText(/Racing.../)).toBeInTheDocument();
  });

  it('displays results after subscription provides them', () => {
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('TimerStatus')) {
        return [{ data: { timerStatus: { status: { state: 'IDLE' } } } }];
      }
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          id: 42,
          laneResults: JSON.stringify([
            { lane: 1, racer_id: 101, time: 3.142, place: 1 },
            { lane: 2, racer_id: 102, time: 3.5, place: 2 },
            { lane: 3, racer_id: null, time: null, place: null },
          ])
        } } }];
      }
      return [{}];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText('3.1420s')).toBeInTheDocument();
    expect(screen.getByText('1st')).toBeInTheDocument();
    expect(screen.getByText('2nd')).toBeInTheDocument();
  });

  it('"Run Another" button appears after results are present and calls onRunAnother', () => {
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          id: 42,
          laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /Run Another/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mockOnRunAnother).toHaveBeenCalledOnce();
  });

  it('Edit Results button opens modal after heat is completed', () => {
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          id: 42,
          laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /Edit/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
  });

  it('Edit modal allows saving corrected times and calls mutation', () => {
    mockRecordResult.mockResolvedValue({ data: { recordFreeRaceResult: { id: 42 } } });
    
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          id: 42,
          laneResults: JSON.stringify([{ lane: 1, racer_id: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3.999' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Results/i }));

    expect(mockRecordResult).toHaveBeenCalledWith(
      expect.objectContaining({ heatId: 42 })
    );
  });

  it('warning badge "results do not affect standings" is always visible', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText(/results do not affect standings/i)).toBeInTheDocument();
  });
});
