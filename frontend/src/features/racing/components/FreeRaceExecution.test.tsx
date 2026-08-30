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
const mockShowAlert = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({
    showAlert: mockShowAlert,
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
  const mockDeleteFreeRaceHeat = vi.fn();

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
    mockDeleteFreeRaceHeat.mockResolvedValue({ data: { deleteFreeRaceHeat: true } });

    (useMutation as any).mockImplementation((query: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('RecordFreeRaceResult')) return [{}, mockRecordResult];
      if (qStr.includes('PrepareHeat')) return [{}, mockPrepareHeat];
      if (qStr.includes('ResetTimer')) return [{}, mockResetTimer];
      if (qStr.includes('DeleteFreeRaceHeat')) return [{}, mockDeleteFreeRaceHeat];
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

  it('saving an edit does not hand a DNF lane first place (issue #397)', async () => {
    mockRecordResult.mockResolvedValue({ data: { recordFreeRaceResult: { id: 42 } } });

    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          // Lane 1 recorded a 0.0 (a DNF) and lane 2 a real time. The old
          // handler sorted ascending by raw time, so the untouched DNF's 0.0
          // beat lane 2's 4.821 and was stamped place 1.
          ...recordedHeat([
            { lane: 1, racerId: 101, time: 0, place: null },
            { lane: 2, racerId: 102, time: 4.821, place: 1 },
          ])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));

    // Save without changing either lane's time.
    fireEvent.click(screen.getByRole('button', { name: /Save Results/i }));

    await waitFor(() => expect(mockRecordResult).toHaveBeenCalled());
    expect(mockRecordResult).toHaveBeenCalledWith({
      heatId: 42,
      lanes: [
        {
          lane: 1,
          racerId: 101,
          placeholderSlot: null,
          time: 0,
          place: null,
          skipped: false,
        },
        {
          lane: 2,
          racerId: 102,
          placeholderSlot: null,
          time: 4.821,
          place: 1,
          skipped: false,
        },
      ],
    });
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

  it('Save Results does not show unsaved times as recorded when the mutation fails', async () => {
    mockRecordResult.mockResolvedValue({ error: new Error('boom') });

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

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());

    // The screen must not flip to showing the locally computed (unsaved)
    // time — the server never stored it.
    expect(screen.queryByText('3.9990s')).not.toBeInTheDocument();
    expect(screen.getByText('3.1420s')).toBeInTheDocument();
    // The edit modal stays open so the operator can retry.
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
  });

  it('Next Heat does not move on when deleting the unfinished heat fails', async () => {
    mockDeleteFreeRaceHeat.mockResolvedValue({ error: new Error('boom') });

    render(<FreeRaceExecution {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Next Heat/i }));

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());
    expect(mockOnRunAnother).not.toHaveBeenCalled();
    expect(mockResetTimer).not.toHaveBeenCalled();
  });

  it('Reset Heat does not clear local results when the clearing mutation fails', async () => {
    mockShowConfirm.mockResolvedValue(true);
    mockRecordResult.mockResolvedValue({ error: new Error('boom') });

    (useSubscription as any).mockImplementation(({ query }: any) => {
      const qStr = JSON.stringify(query);
      if (qStr.includes('FreeRaceHeat')) {
        return [{ data: { freeRaceHeat: {
          ...recordedHeat([{ lane: 1, racerId: 101, time: 3.142, place: 1 }])
        } } }];
      }
      return [{ data: null }];
    });

    render(<FreeRaceExecution {...defaultProps} trackId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Reset Heat/i }));

    await waitFor(() => expect(mockShowConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());

    // The recorded time is still on screen — the server still holds it.
    expect(screen.getByText('3.1420s')).toBeInTheDocument();
    expect(mockResetTimer).not.toHaveBeenCalled();
    expect(mockPrepareHeat).not.toHaveBeenCalled();
  });

  it('Reset Heat does not re-arm the timer when resetTimer fails', async () => {
    mockShowConfirm.mockResolvedValue(true);
    mockResetTimer.mockResolvedValue({ error: new Error('boom') });

    render(<FreeRaceExecution {...defaultProps} trackId={1} />);
    // The auto-prepare effect already called this once on mount.
    mockPrepareHeat.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Reset Heat/i }));

    await waitFor(() => expect(mockShowConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());

    expect(mockPrepareHeat).not.toHaveBeenCalled();
  });

  describe('on a track with no timer (#526)', () => {
    const noTimerProps = { ...defaultProps, timerType: 'NONE' };

    it('Enter Results opens a modal asking for a place, not a time', () => {
      render(<FreeRaceExecution {...noTimerProps} />);

      fireEvent.click(screen.getByRole('button', { name: /Enter Results/i }));

      expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
      expect(screen.getAllByPlaceholderText('Place').length).toBeGreaterThan(0);
      expect(screen.queryByPlaceholderText('Time (s)')).not.toBeInTheDocument();
    });

    it('keeps the time column, unchanged, on a track that has a timer', () => {
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

      expect(screen.getByPlaceholderText('Time (s)')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Place')).not.toBeInTheDocument();
    });

    it('saving hand-typed places does not clear them (issue #526)', async () => {
      // This is the bug: `handleSaveEdit` used to run every save through
      // `assignPlaces` unconditionally, and `assignPlaces` reads "no time
      // anywhere" as "clear every place" — exactly what a no-timer track's
      // modal produces, since it never collects a time at all.
      render(<FreeRaceExecution {...noTimerProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Enter Results/i }));

      const placeInputs = screen.getAllByPlaceholderText('Place');
      fireEvent.change(placeInputs[0], { target: { value: '2' } });
      fireEvent.change(placeInputs[1], { target: { value: '1' } });

      fireEvent.click(screen.getByRole('button', { name: /Save Results/i }));

      await waitFor(() => expect(mockRecordResult).toHaveBeenCalled());
      expect(mockRecordResult).toHaveBeenCalledWith({
        heatId: 42,
        lanes: [
          { lane: 1, racerId: 101, placeholderSlot: null, time: null, place: 2, skipped: false },
          { lane: 2, racerId: 102, placeholderSlot: null, time: null, place: 1, skipped: false },
          { lane: 3, racerId: null, placeholderSlot: null, time: null, place: null, skipped: false },
        ],
      });
    });

    it('treats a non-positive or non-numeric hand-typed place as unplaced (#524)', () => {
      render(<FreeRaceExecution {...noTimerProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Enter Results/i }));

      const placeInputs = screen.getAllByPlaceholderText('Place');
      fireEvent.change(placeInputs[0], { target: { value: '0' } });
      expect((placeInputs[0] as HTMLInputElement).value).toBe('');

      fireEvent.change(placeInputs[1], { target: { value: '-1' } });
      expect((placeInputs[1] as HTMLInputElement).value).toBe('');
    });
  });
});
