import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

/**
 * #939: Delete Round and Regenerate used to call their mutations straight
 * away — `handleDeleteHeat`, two functions below, already went through
 * `showConfirm`. This is the round-level half brought up to the same bar,
 * plus the "skip the prompt when nothing was reordered or pinned" carve-out
 * for Regenerate.
 *
 * Captures the real (unmocked) `onDeleteRound`/`onRegenerateRound` functions
 * `RaceControl` hands down, so a test can call them directly the way
 * `ScheduleManagement`'s own buttons do — the same shape
 * `RaceControlReorder.test.tsx` uses for `onReorderHeats`.
 */
let capturedOnDeleteRound: ((roundId: number) => Promise<void>) | undefined;
let capturedOnRegenerateRound: ((roundId: number, silent?: boolean) => Promise<void>) | undefined;

vi.mock('../components/ScheduleManagement', () => ({
  ScheduleManagement: ({ onDeleteRound, onRegenerateRound }: any) => {
    capturedOnDeleteRound = onDeleteRound;
    capturedOnRegenerateRound = onRegenerateRound;
    return <div data-testid="schedule-management">Schedule Management</div>;
  },
}));

vi.mock('../components/RaceExecution', () => ({
  RaceExecution: () => <div data-testid="race-execution">Race Execution</div>,
}));

vi.mock('../components/FreeRaceTab', () => ({
  FreeRaceTab: () => <div data-testid="free-race-tab">Free Race Tab</div>,
}));

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

const showConfirm = vi.fn().mockResolvedValue(true);
const showAlert = vi.fn();
const showToast = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({ showAlert, showConfirm, showToast }),
}));

/** A round untouched since it was generated — heatNumber rises in id order. */
const untouchedHeats = [
  { id: 101, roundId: 10, roundNumber: 1, heatNumber: 1, roundName: 'All Pack', recordedAt: null, lanes: [] },
  { id: 102, roundId: 10, roundNumber: 1, heatNumber: 2, roundName: 'All Pack', recordedAt: null, lanes: [] },
  { id: 103, roundId: 10, roundNumber: 1, heatNumber: 3, roundName: 'All Pack', recordedAt: null, lanes: [] },
];

/** The same round, but heat 103 was dragged ahead of heat 102. */
const draggedHeats = [
  { id: 101, roundId: 10, roundNumber: 1, heatNumber: 1, roundName: 'All Pack', recordedAt: null, lanes: [] },
  { id: 102, roundId: 10, roundNumber: 1, heatNumber: 3, roundName: 'All Pack', recordedAt: null, lanes: [] },
  { id: 103, roundId: 10, roundNumber: 1, heatNumber: 2, roundName: 'All Pack', recordedAt: null, lanes: [] },
];

function mockRaceData(heats: typeof untouchedHeats, roundOverrides: Record<string, unknown> = {}, masterRunningOrder = false) {
  return {
    race: {
      id: 1,
      name: 'Test Race',
      championshipTrophies: 3,
      scoringStrategy: 'TIMED',
      autoAdvanceHeat: false,
      registeredCount: 4,
      checkedInCount: 4,
      isLocked: false,
      masterRunningOrder,
      track: { id: 1, laneCount: 4, timerType: 'FAKE', laneOutages: [], laneColors: [] },
      racingGroups: [],
      racers: [],
      heats,
      rounds: [
        {
          id: 10,
          roundNumber: 1,
          name: 'All Pack',
          advancementSource: null,
          advancementFromBottom: false,
          fieldPinned: false,
          schedulingStrategy: 'PPC',
          racingGroupId: null,
          eliminationChart: null,
          advancementStatus: {
            isReady: false,
            requiresAdvancement: false,
            alreadyAdvanced: false,
            fieldIsStale: false,
            contestedCut: false,
            fieldIsPinned: false,
            source: null,
            numRacers: null,
            fromBottom: false,
            advancingRacers: [],
          },
          ...roundOverrides,
        },
      ],
    },
  };
}

function mockQueries(data: ReturnType<typeof mockRaceData>) {
  (useQuery as any).mockImplementation((args: { query: unknown }) => {
    if (args.query === INITIAL_CONFIG_QUERY) {
      return [{ data: { initialConfig: { role: 'OPERATOR' } }, fetching: false, error: null }, vi.fn()];
    }
    return [{ data, fetching: false, error: null }, vi.fn()];
  });
}

function mockMutations(deleteRound = vi.fn().mockResolvedValue({ data: {} }), regenerateRound = vi.fn().mockResolvedValue({ data: {} })) {
  (useMutation as any).mockImplementation((query: any) => {
    const qStr = JSON.stringify(query);
    if (qStr.includes('deleteRound')) return [{ fetching: false }, deleteRound];
    if (qStr.includes('regenerateRound')) return [{ fetching: false }, regenerateRound];
    return [{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })];
  });
  return { deleteRound, regenerateRound };
}

function renderRaceControl() {
  return render(
    <MemoryRouter initialEntries={['/race/1/control/schedule']}>
      <Routes>
        <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  showConfirm.mockResolvedValue(true);
  capturedOnDeleteRound = undefined;
  capturedOnRegenerateRound = undefined;
  (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('Delete Round', () => {
  it('confirms first, naming the round and how many heats are at stake', async () => {
    mockQueries(mockRaceData(untouchedHeats));
    const { deleteRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    expect(capturedOnDeleteRound).toBeDefined();

    await capturedOnDeleteRound!(10);

    expect(showConfirm).toHaveBeenCalledWith(
      'Delete All Pack? Its 3 heats have not been run. This cannot be undone.',
      'Delete Round',
      'Delete',
      'danger'
    );
    expect(deleteRound).toHaveBeenCalledWith({ roundId: 10 });
  });

  it('does not delete when the confirmation is declined', async () => {
    showConfirm.mockResolvedValue(false);
    mockQueries(mockRaceData(untouchedHeats));
    const { deleteRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnDeleteRound!(10);

    expect(showConfirm).toHaveBeenCalled();
    expect(deleteRound).not.toHaveBeenCalled();
  });
});

describe('Regenerate', () => {
  it('skips the prompt when nothing was reordered or pinned', async () => {
    mockQueries(mockRaceData(untouchedHeats));
    const { regenerateRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    expect(capturedOnRegenerateRound).toBeDefined();

    await capturedOnRegenerateRound!(10);

    expect(showConfirm).not.toHaveBeenCalled();
    expect(regenerateRound).toHaveBeenCalledWith({ roundId: 10 });
  });

  it('confirms first when a heat was dragged out of its generated order', async () => {
    mockQueries(mockRaceData(draggedHeats));
    const { regenerateRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRegenerateRound!(10);

    expect(showConfirm).toHaveBeenCalledWith(
      'Regenerate All Pack? The current running order, including any heats you dragged, will be replaced.',
      'Regenerate Round',
      'Regenerate',
      'danger'
    );
    expect(regenerateRound).toHaveBeenCalledWith({ roundId: 10 });
  });

  it('does not regenerate when the confirmation is declined', async () => {
    showConfirm.mockResolvedValue(false);
    mockQueries(mockRaceData(draggedHeats));
    const { regenerateRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRegenerateRound!(10);

    expect(showConfirm).toHaveBeenCalled();
    expect(regenerateRound).not.toHaveBeenCalled();
  });

  it('always confirms when the round was hand-picked, even with an untouched heat order', async () => {
    mockQueries(mockRaceData(untouchedHeats, { fieldPinned: true }));
    const { regenerateRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRegenerateRound!(10);

    expect(showConfirm).toHaveBeenCalled();
    expect(regenerateRound).toHaveBeenCalledWith({ roundId: 10 });
  });

  it('always confirms when the race runs the master running order', async () => {
    mockQueries(mockRaceData(untouchedHeats, {}, true));
    const { regenerateRound } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRegenerateRound!(10);

    expect(showConfirm).toHaveBeenCalled();
    expect(regenerateRound).toHaveBeenCalledWith({ roundId: 10 });
  });
});
