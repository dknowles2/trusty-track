import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RunOffControl from './RunOffControl';
import {
  CREATE_RUN_OFF_HEAT_MUTATION,
  DELETE_RUN_OFF_HEAT_MUTATION,
  PREPARE_HEAT,
  UPDATE_HEAT_RESULT_MUTATION,
} from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

const showAlert = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({ showAlert, showConfirm: vi.fn(), showToast: vi.fn() }),
}));

const createRunOffHeat = vi.fn();
const deleteRunOffHeat = vi.fn();
const prepareHeat = vi.fn();
const updateHeatResult = vi.fn();
const refetchExisting = vi.fn();

/** Stand in for `GET_RUN_OFF_HEATS` — the race's current run-off heats. */
function mockRunOffHeats(runOffHeats: unknown[]) {
  (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: { race: { id: 1, runOffHeats } }, fetching: false, error: null },
    refetchExisting,
  ]);
}

const racers = [
  { racerId: 101, name: 'Jordan Mitchell' },
  { racerId: 102, name: 'Riley Chen' },
];

beforeEach(() => {
  vi.clearAllMocks();

  createRunOffHeat.mockResolvedValue({ data: {}, error: undefined });
  deleteRunOffHeat.mockResolvedValue({ data: {}, error: undefined });
  prepareHeat.mockResolvedValue({ data: { prepareHeat: true }, error: undefined });
  updateHeatResult.mockResolvedValue({ data: {}, error: undefined });

  // Discriminated by document, the same shape DisplaysPanel's test uses —
  // the four mutations this control fires send different variable shapes,
  // and a single shared spy could not tell which one actually ran.
  (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(
    (query: unknown) => {
      if (query === CREATE_RUN_OFF_HEAT_MUTATION) return [{ fetching: false }, createRunOffHeat];
      if (query === DELETE_RUN_OFF_HEAT_MUTATION) return [{ fetching: false }, deleteRunOffHeat];
      if (query === PREPARE_HEAT) return [{ fetching: false }, prepareHeat];
      if (query === UPDATE_HEAT_RESULT_MUTATION) return [{ fetching: false }, updateHeatResult];
      return [{ fetching: false }, vi.fn()];
    },
  );

  // No live timer session by default — most of what this control does is
  // about the stored run-off heat, not a run under way.
  (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockReturnValue([{ data: undefined }]);
});

describe('no run-off exists yet for this tied cluster', () => {
  it('offers to start one rather than showing the panel', () => {
    mockRunOffHeats([]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.getByTestId('start-run-off-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('run-off-panel')).toBeNull();
  });

  it('creates the run-off for exactly the tied racers and the cut it settles', async () => {
    mockRunOffHeats([]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    fireEvent.click(screen.getByTestId('start-run-off-btn'));

    await waitFor(() => {
      expect(createRunOffHeat).toHaveBeenCalledWith({
        raceId: 1,
        racerIds: [101, 102],
        settlesRoundId: 3,
      });
    });
  });

  it('refetches so the newly created run-off appears', async () => {
    mockRunOffHeats([]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={null} racers={racers} />);

    fireEvent.click(screen.getByTestId('start-run-off-btn'));

    await waitFor(() => {
      expect(refetchExisting).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });
  });

  it('surfaces the server’s refusal — too few racers to break a tie between', async () => {
    mockRunOffHeats([]);
    createRunOffHeat.mockResolvedValue({
      error: { graphQLErrors: [{ message: 'A run-off needs at least two racers.' }] },
    });
    render(
      <RunOffControl raceId={1} trackId={5} settlesRoundId={null} racers={[racers[0]]} />,
    );

    fireEvent.click(screen.getByTestId('start-run-off-btn'));

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalledWith(
        'A run-off needs at least two racers.',
        'Error',
      );
    });
    // A refusal must not be treated as success.
    expect(refetchExisting).not.toHaveBeenCalled();
  });

  it('surfaces the server’s refusal — more tied racers than usable lanes', async () => {
    // No `usableLaneCount` passed here on purpose — this is the backstop for
    // a caller that has not supplied one (or one that went stale between
    // render and click, a lane failing mid-event), not the ordinary path.
    // #766 adds the client-side check below for the ordinary path.
    mockRunOffHeats([]);
    createRunOffHeat.mockResolvedValue({
      error: { graphQLErrors: [{ message: 'More tied racers than usable lanes.' }] },
    });
    const tooMany = [...racers, { racerId: 103, name: 'Sam Ortiz' }];
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={null} racers={tooMany} />);

    fireEvent.click(screen.getByTestId('start-run-off-btn'));

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalledWith(
        'More tied racers than usable lanes.',
        'Error',
      );
    });
  });

  // #766: offering "Start run-off" for a cluster wider than the track can
  // ever race produced nothing but that generic server refusal. Given the
  // usable lane count, the button now says why before it is even clicked.
  describe('the tied cluster can be wider than the track (#766)', () => {
    const tooMany = [...racers, { racerId: 103, name: 'Sam Ortiz' }];

    it('disables the button and names both counts when the cluster exceeds the usable lanes', () => {
      mockRunOffHeats([]);
      render(
        <RunOffControl
          raceId={1}
          trackId={5}
          settlesRoundId={null}
          racers={tooMany}
          usableLaneCount={2}
        />,
      );

      const button = screen.getByTestId('start-run-off-btn');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        'Not enough usable lanes for all 3 tied racers (only 2 available).',
      );
    });

    it('leaves the button enabled when the track has room for the whole cluster', () => {
      mockRunOffHeats([]);
      render(
        <RunOffControl
          raceId={1}
          trackId={5}
          settlesRoundId={null}
          racers={tooMany}
          usableLaneCount={3}
        />,
      );

      expect(screen.getByTestId('start-run-off-btn')).not.toBeDisabled();
    });

    it('leaves the button enabled when the usable lane count is not known', () => {
      mockRunOffHeats([]);
      render(
        <RunOffControl
          raceId={1}
          trackId={5}
          settlesRoundId={null}
          racers={tooMany}
          usableLaneCount={null}
        />,
      );

      expect(screen.getByTestId('start-run-off-btn')).not.toBeDisabled();
    });

    it('never calls createRunOffHeat from a disabled button', () => {
      mockRunOffHeats([]);
      render(
        <RunOffControl
          raceId={1}
          trackId={5}
          settlesRoundId={null}
          racers={tooMany}
          usableLaneCount={2}
        />,
      );

      fireEvent.click(screen.getByTestId('start-run-off-btn'));

      expect(createRunOffHeat).not.toHaveBeenCalled();
    });

    it('a race lock still wins the title over the lane-count reason', () => {
      // Both disable the button; the lock is the more urgent thing to say —
      // it means nothing here can be created at all right now.
      (useQuery as ReturnType<typeof vi.fn>).mockReturnValue([
        { data: { race: { id: 1, runOffHeats: [], isLocked: true } }, fetching: false, error: null },
        refetchExisting,
      ]);
      render(
        <RunOffControl
          raceId={1}
          trackId={5}
          settlesRoundId={null}
          racers={tooMany}
          usableLaneCount={2}
        />,
      );

      const button = screen.getByTestId('start-run-off-btn');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'This race is locked. Unlock it from Edit race to make changes.');
    });
  });
});

describe('an existing run-off for this cluster', () => {
  const existingHeat = {
    id: 55,
    settlesRoundId: 3,
    recorded: false,
    placement: 2,
    lanes: [
      { lane: 1, racerId: 101 },
      { lane: 2, racerId: 102 },
    ],
  };

  it('is matched by racer set and settlesRoundId, not by being the newest heat', () => {
    mockRunOffHeats([
      // A run-off for a different cut — must not match.
      { ...existingHeat, id: 1, settlesRoundId: 9 },
      existingHeat,
    ]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.getByTestId('run-off-panel')).toBeInTheDocument();
    expect(screen.getByText('Run-off: Jordan Mitchell vs. Riley Chen')).toBeInTheDocument();
    expect(screen.queryByTestId('start-run-off-btn')).toBeNull();
  });

  it('falls back to offering to start one when no run-off matches this exact racer set', () => {
    mockRunOffHeats([existingHeat]);
    // Same round, different pair of tied racers.
    render(
      <RunOffControl
        raceId={1}
        trackId={5}
        settlesRoundId={3}
        racers={[{ racerId: 201, name: 'Alex Kim' }, { racerId: 202, name: 'Sam Lee' }]}
      />,
    );

    expect(screen.getByTestId('start-run-off-btn')).toBeInTheDocument();
  });

  it('announces which place the run-off is racing to decide', () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.getByText('Racing off for 2nd place')).toBeInTheDocument();
  });

  it('says nothing when the tie has no announceable placement', () => {
    mockRunOffHeats([{ ...existingHeat, placement: null }]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.queryByText(/Racing off for/)).toBeNull();
  });

  it('offers no arm-timer control when the race has no track configured', () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={null} settlesRoundId={3} racers={racers} />);

    expect(screen.queryByText('Arm timer')).toBeNull();
  });

  it('arms the timer for the run-off heat itself, not some other heat', async () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    fireEvent.click(screen.getByText('Arm timer'));

    await waitFor(() => {
      expect(prepareHeat).toHaveBeenCalledWith({ heatId: 55 });
    });
  });

  it('shows the heat as racing once the timer session reports RUNNING', () => {
    mockRunOffHeats([existingHeat]);
    (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockReturnValue([
      { data: { heatSession: { phase: 'RUNNING' } } },
    ]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.getByText('Racing…')).toBeInTheDocument();
    expect(screen.queryByText('Arm timer')).toBeNull();
  });

  it('undoes a run-off created by mistake', async () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    fireEvent.click(screen.getByText('Cancel run-off'));

    await waitFor(() => {
      expect(deleteRunOffHeat).toHaveBeenCalledWith({ heatId: 55 });
      expect(refetchExisting).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
    });
  });

  it('surfaces the server’s refusal to undo a decided run-off', async () => {
    mockRunOffHeats([existingHeat]);
    deleteRunOffHeat.mockResolvedValue({
      error: { graphQLErrors: [{ message: 'The run-off has already been decided.' }] },
    });
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    fireEvent.click(screen.getByText('Cancel run-off'));

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalledWith(
        'The run-off has already been decided.',
        'Error',
      );
    });
  });

  it('refuses to record a result missing a time for every racer', () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    // Only one of the two racers gets a time.
    fireEvent.change(screen.getByLabelText('Jordan Mitchell'), {
      target: { value: '3.501' },
    });
    fireEvent.click(screen.getByText('Record result'));

    expect(showAlert).toHaveBeenCalledWith(
      'Enter a time for every racer before recording.',
      'Missing times',
    );
    expect(updateHeatResult).not.toHaveBeenCalled();
  });

  it('records manually entered times through the ordinary result door', async () => {
    mockRunOffHeats([existingHeat]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    fireEvent.change(screen.getByLabelText('Jordan Mitchell'), {
      target: { value: '3.501' },
    });
    fireEvent.change(screen.getByLabelText('Riley Chen'), {
      target: { value: '3.612' },
    });
    fireEvent.click(screen.getByText('Record result'));

    await waitFor(() => {
      expect(updateHeatResult).toHaveBeenCalledWith({
        heatId: 55,
        lanes: [
          { lane: 1, racerId: 101, time: 3.501, place: null, skipped: false },
          { lane: 2, racerId: 102, time: 3.612, place: null, skipped: false },
        ],
      });
    });
  });

  it('shows the decided state and hides entry controls once recorded', () => {
    mockRunOffHeats([{ ...existingHeat, recorded: true }]);
    render(<RunOffControl raceId={1} trackId={5} settlesRoundId={3} racers={racers} />);

    expect(screen.getByText('Run-off decided.')).toBeInTheDocument();
    expect(screen.queryByText('Record result')).toBeNull();
    expect(screen.queryByText('Cancel run-off')).toBeNull();
    expect(screen.queryByText('Arm timer')).toBeNull();
  });
});
