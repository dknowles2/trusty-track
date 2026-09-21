import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { INITIAL_CONFIG_QUERY } from '../../core/graphql/queries';

/**
 * #1083: Re-Run on a completed heat used to clear every lane's recorded
 * time and place with no confirmation — the most destructive single click
 * on the race-day screen, sitting right next to Edit. `handleRunHeat` now
 * confirms first whenever the heat holds a recorded time or place
 * (`hasTimes`, not `hasRun` — a heat that was only ever skipped has nothing
 * to lose, and the button reads "Run" rather than "Re-Run" for exactly that
 * case, so it must not ask).
 *
 * #1295: past the confirm and the clear, Re-Run now does exactly what Run
 * does — select the heat and navigate to the Race tab — rather than
 * stopping once the clear lands. `handleRunHeat` no longer takes a
 * `shouldStart` argument at all; every caller gets the same path.
 *
 * Same shape as `RaceControlScheduleConfirm.test.tsx`: capture the real
 * `onRunHeat` function `RaceControl` hands to `ScheduleManagement` — the
 * Schedule tab's own Re-Run button — and call it directly, with
 * `useAlert`'s `showConfirm` mocked so the gate can be asserted without
 * fighting the real modal's DOM.
 */
let capturedOnRunHeat: ((heat: any) => Promise<void>) | undefined;
let capturedActiveExecutionHeat: { id: number } | null = null;

vi.mock('../components/ScheduleManagement', () => ({
  ScheduleManagement: ({ onRunHeat }: any) => {
    capturedOnRunHeat = onRunHeat;
    return <div data-testid="schedule-management">Schedule Management</div>;
  },
}));

// Exposes `activeExecutionHeat` so a test can confirm the #130 pin landed on
// the heat Re-Run just cleared, not whatever heat the fallback would have
// picked — the exact failure #1295 describes ("switching over shows that
// pinned heat, not the one they just cleared").
vi.mock('../components/RaceExecution', () => ({
  RaceExecution: ({ activeExecutionHeat }: any) => {
    capturedActiveExecutionHeat = activeExecutionHeat;
    return (
      <div data-testid="race-execution">
        Race Execution
        {activeExecutionHeat && <div data-testid="active-heat-id">{activeExecutionHeat.id}</div>}
      </div>
    );
  },
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

// `useNavigate` is wrapped, not replaced — everything else (MemoryRouter,
// Routes, useLocation, useParams) stays real, and so does the navigation
// itself: a test needs the URL to genuinely change to the Race tab so the
// mocked `RaceExecution` above actually mounts and reports which heat
// landed on screen, not just that `navigate` was called with the right
// string.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useNavigate: () => {
      const realNavigate = actual.useNavigate();
      return (...args: Parameters<typeof realNavigate>) => {
        mockNavigate(...args);
        return realNavigate(...args);
      };
    },
  };
});

const showConfirm = vi.fn().mockResolvedValue(true);
const showAlert = vi.fn();
const showToast = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({ showAlert, showConfirm, showToast }),
}));

const completedHeat = {
  id: 1,
  roundId: 10,
  roundNumber: 1,
  heatNumber: 7,
  lanes: [
    { lane: 1, racerId: 101, placeholderSlot: null, time: 3.5, place: 1, skipped: false },
    { lane: 2, racerId: 102, placeholderSlot: null, time: 3.8, place: 2, skipped: false },
  ],
  replays: [],
};

/** Passed over rather than raced — nothing recorded, nothing to lose. */
const skippedHeat = {
  id: 2,
  roundId: 10,
  roundNumber: 1,
  heatNumber: 8,
  lanes: [
    { lane: 1, racerId: 103, placeholderSlot: null, time: null, place: null, skipped: true },
    { lane: 2, racerId: 104, placeholderSlot: null, time: null, place: null, skipped: true },
  ],
  replays: [],
};

/** Never run at all — not skipped, no time, no place. */
const freshHeat = {
  id: 3,
  roundId: 10,
  roundNumber: 1,
  heatNumber: 9,
  lanes: [
    { lane: 1, racerId: 105, placeholderSlot: null, time: null, place: null, skipped: false },
    { lane: 2, racerId: 106, placeholderSlot: null, time: null, place: null, skipped: false },
  ],
  replays: [],
};

function mockRaceData(heats: unknown[], masterRunningOrder = false) {
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

function mockMutations(
  updateHeatResult = vi.fn().mockResolvedValue({ data: {} }),
  reorderHeats = vi.fn().mockResolvedValue({ data: {} })
) {
  (useMutation as any).mockImplementation((query: any) => {
    const qStr = JSON.stringify(query);
    if (qStr.includes('updateHeatResult')) return [{ fetching: false }, updateHeatResult];
    if (qStr.includes('reorderHeats')) return [{ fetching: false }, reorderHeats];
    return [{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })];
  });
  return { updateHeatResult, reorderHeats };
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
  capturedOnRunHeat = undefined;
  capturedActiveExecutionHeat = null;
  mockNavigate.mockClear();
  (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('Re-Run confirmation (#1083)', () => {
  it('confirms first, naming the heat and how many lanes hold a result', async () => {
    mockQueries(mockRaceData([completedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    expect(capturedOnRunHeat).toBeDefined();

    await capturedOnRunHeat!(completedHeat);

    expect(showConfirm).toHaveBeenCalledWith(
      'Re-run Heat 7? This clears the recorded results for its 2 lanes. The cars will race again and the standings will update.',
      'Re-run Heat',
      'Re-run',
      'danger'
    );
    expect(updateHeatResult).toHaveBeenCalledWith({
      heatId: 1,
      lanes: [
        { lane: 1, racerId: 101, placeholderSlot: null, time: null, place: null, skipped: false },
        { lane: 2, racerId: 102, placeholderSlot: null, time: null, place: null, skipped: false },
      ],
    });
  });

  it('does not clear results when the confirmation is declined', async () => {
    showConfirm.mockResolvedValue(false);
    mockQueries(mockRaceData([completedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(completedHeat);

    expect(showConfirm).toHaveBeenCalled();
    expect(updateHeatResult).not.toHaveBeenCalled();
  });

  it('asks nothing for a skipped heat that never recorded a result — there is nothing to lose', async () => {
    mockQueries(mockRaceData([skippedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(skippedHeat);

    expect(showConfirm).not.toHaveBeenCalled();
    // A skipped heat is still `hasRun`, so it goes through the ordinary
    // clear (un-skipping it) — but silently, since nothing was ever
    // recorded to lose.
    expect(updateHeatResult).toHaveBeenCalled();
  });

  it('asks nothing, and clears nothing, for a heat that has never run at all', async () => {
    mockQueries(mockRaceData([freshHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(freshHeat);

    expect(showConfirm).not.toHaveBeenCalled();
    expect(updateHeatResult).not.toHaveBeenCalled();
  });
});

/**
 * #1295: Re-Run used to clear the heat and then stop, leaving the operator
 * on the Schedule tab with no indication of which heat was now up next. It
 * now does what Run does once the clear (if any) lands: select the heat and
 * navigate to the Race tab, so the #130 pin lands on the heat that was just
 * cleared rather than whatever the fallback would otherwise pick.
 */
describe('Re-Run navigates, the same as Run (#1295)', () => {
  it('confirmed: clears the heat, selects it, and navigates to the Race tab', async () => {
    mockQueries(mockRaceData([completedHeat]));
    const { updateHeatResult, reorderHeats } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(completedHeat);

    expect(updateHeatResult).toHaveBeenCalledWith({
      heatId: 1,
      lanes: [
        { lane: 1, racerId: 101, placeholderSlot: null, time: null, place: null, skipped: false },
        { lane: 2, racerId: 102, placeholderSlot: null, time: null, place: null, skipped: false },
      ],
    });
    // The only heat in its round, so there is nothing to jump ahead of.
    expect(reorderHeats).not.toHaveBeenCalled();
    // Navigation is real (only `useNavigate` is wrapped, not stubbed out),
    // so this settles once the route — and the mocked `RaceExecution` it
    // mounts — actually changes.
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/race/1/control/race'));
    await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());
    // The #130 pin: the heat just cleared is the one now selected, not
    // whatever heat the "first still to be run" fallback would land on.
    expect(capturedActiveExecutionHeat?.id).toBe(completedHeat.id);
  });

  it('declined: clears nothing and never navigates', async () => {
    showConfirm.mockResolvedValue(false);
    mockQueries(mockRaceData([completedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(completedHeat);

    expect(updateHeatResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Still on the Schedule tab.
    expect(screen.getByTestId('schedule-management')).toBeInTheDocument();
  });

  it("a never-run heat's Run is unchanged: no confirm, no clear, still selects and navigates", async () => {
    mockQueries(mockRaceData([freshHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(freshHeat);

    expect(showConfirm).not.toHaveBeenCalled();
    expect(updateHeatResult).not.toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/race/1/control/race'));
    await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());
    expect(capturedActiveExecutionHeat?.id).toBe(freshHeat.id);
  });

  it('under a master running order, re-running an earlier heat still selects and navigates, but does not reorder', async () => {
    // heatUnraced sits ahead of completedHeat in heat-number order — without
    // a master running order this would trigger the jump-ahead reorder;
    // under one, `handleRunHeat` skips it outright (`.claude/rules/scheduling.md`'s
    // "master running order" — renumbering 1..N would yank the round to the
    // head of the race-wide interleave).
    const heatUnraced = {
      id: 4,
      roundId: 10,
      roundNumber: 1,
      heatNumber: 6,
      lanes: [{ lane: 1, racerId: 107, placeholderSlot: null, time: null, place: null, skipped: false }],
      replays: [],
    };
    mockQueries(mockRaceData([heatUnraced, completedHeat], true));
    const { updateHeatResult, reorderHeats } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(completedHeat);

    expect(updateHeatResult).toHaveBeenCalled();
    expect(reorderHeats).not.toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/race/1/control/race'));
    await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());
    // The #130 pin: without a master running order this would also be
    // reachable by the "first heat still to be run" fallback landing on
    // `completedHeat` by coincidence — `heatUnraced` is what makes this a
    // real check of `setSelectedHeatId`, since the fallback would otherwise
    // land there instead.
    expect(capturedActiveExecutionHeat?.id).toBe(completedHeat.id);
  });
});
