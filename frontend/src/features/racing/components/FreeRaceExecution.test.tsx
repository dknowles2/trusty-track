import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useSubscription } from 'urql';
import { FreeRaceExecution } from './FreeRaceExecution';
import { lane } from '../testFixtures';

/**
 * A free race heat the backend has recorded a result for.
 *
 * `recorded` is what marks it run — `lanes` holds the schedule from the moment
 * the heat is created, so it cannot say that on its own (#6).
 */
const recordedHeat = (lanes: (Partial<Parameters<typeof lane>[0]> & { lane: number })[]) => ({
  id: 42,
  recorded: true,
  lanes: lanes.map(lane),
});

const mockShowConfirm = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({
    showAlert: vi.fn(),
    showConfirm: mockShowConfirm,
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

vi.mock('../../../components/ui/Modal', () => ({
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
  const mockResetTimer = vi.fn();

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
    mockRecordResult.mockResolvedValue({ data: { recordFreeRaceResult: { id: 42, lanes: [] } } });
    mockResetTimer.mockResolvedValue({ data: { resetTimer: true } });

    (useMutation as any).mockImplementation((query: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('RecordFreeRaceResult')) return [{}, mockRecordResult];
      if (qStr.includes('PrepareHeat')) return [{}, mockPrepareHeat];
      if (qStr.includes('ResetTimer')) return [{}, mockResetTimer];
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
    expect(mockPrepareHeat).toHaveBeenCalledWith({ heatId: 42, isFreeRace: true });
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
          ...recordedHeat([
            { lane: 1, racerId: 101, time: 3.142, place: 1 },
            { lane: 2, racerId: 102, time: 3.5, place: 2 },
            { lane: 3 },
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
          ...recordedHeat([{ lane: 1, racerId: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /Next Heat/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mockOnRunAnother).toHaveBeenCalledOnce();
  });

  it('Edit Results button opens modal after heat is completed', () => {
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          ...recordedHeat([{ lane: 1, racerId: 101, time: 3.142, place: 1 }])
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
          ...recordedHeat([{ lane: 1, racerId: 101, time: 3.142, place: 1 }])
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

  it('Reset Heat button clears results and re-prepares heat', async () => {
    mockShowConfirm.mockResolvedValue(true);
    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('TimerStatus')) {
        return [{ data: { timerStatus: { status: { state: 'IDLE' } } } }];
      }
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          ...recordedHeat([{ lane: 1, racerId: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} trackId={1} />);

    // Should see "Reset Heat" button
    const btn = screen.getByRole('button', { name: /Reset Heat/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    await waitFor(() => expect(mockShowConfirm).toHaveBeenCalled());
    // The lane assignment survives; only the result goes. This used to send
    // `results: 'null'` — a variable the mutation does not declare, so the
    // required `lanes` was missing, the call failed, and the times stayed in
    // the database while the screen showed an empty heat.
    await waitFor(() => expect(mockRecordResult).toHaveBeenCalledWith({
      heatId: 42,
      lanes: [
        {
          lane: 1,
          racerId: 101,
          placeholderSlot: null,
          time: null,
          place: null,
          skipped: false,
        },
      ],
    }));
    await waitFor(() => expect(mockResetTimer).toHaveBeenCalledWith({ trackId: 1 }));
    await waitFor(() => expect(mockPrepareHeat).toHaveBeenCalledWith({ heatId: 42, isFreeRace: true }));

    // Should NOT have called onRunAnother (stay on page)
    expect(mockOnRunAnother).not.toHaveBeenCalled();
  });

  it('warning badge "results do not affect standings" is always visible', () => {
    render(<FreeRaceExecution {...defaultProps} />);
    expect(screen.getByText(/results do not affect standings/i)).toBeInTheDocument();
  });
});
