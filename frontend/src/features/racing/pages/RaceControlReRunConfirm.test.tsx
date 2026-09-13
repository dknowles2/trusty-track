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
 * Same shape as `RaceControlScheduleConfirm.test.tsx`: capture the real
 * `onRunHeat` function `RaceControl` hands to `ScheduleManagement` — the
 * Schedule tab's own Re-Run button — and call it directly, with
 * `useAlert`'s `showConfirm` mocked so the gate can be asserted without
 * fighting the real modal's DOM.
 */
let capturedOnRunHeat: ((heat: any, shouldStart?: boolean) => Promise<void>) | undefined;

vi.mock('../components/ScheduleManagement', () => ({
  ScheduleManagement: ({ onRunHeat }: any) => {
    capturedOnRunHeat = onRunHeat;
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

const completedHeat = {
  id: 1,
  roundId: 10,
  roundNumber: 1,
  heatNumber: 7,
  lanes: [
    { lane: 1, racerId: 101, placeholderSlot: null, time: 3.5, place: 1, skipped: false },
    { lane: 2, racerId: 102, placeholderSlot: null, time: 3.8, place: 2, skipped: false },
  ],
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
};

function mockRaceData(heats: unknown[]) {
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
      masterRunningOrder: false,
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

function mockMutations(updateHeatResult = vi.fn().mockResolvedValue({ data: {} })) {
  (useMutation as any).mockImplementation((query: any) => {
    const qStr = JSON.stringify(query);
    if (qStr.includes('updateHeatResult')) return [{ fetching: false }, updateHeatResult];
    return [{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })];
  });
  return { updateHeatResult };
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
  (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('Re-Run confirmation (#1083)', () => {
  it('confirms first, naming the heat and how many lanes hold a result', async () => {
    mockQueries(mockRaceData([completedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    expect(capturedOnRunHeat).toBeDefined();

    await capturedOnRunHeat!(completedHeat, false);

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
    await capturedOnRunHeat!(completedHeat, false);

    expect(showConfirm).toHaveBeenCalled();
    expect(updateHeatResult).not.toHaveBeenCalled();
  });

  it('asks nothing for a skipped heat that never recorded a result — there is nothing to lose', async () => {
    mockQueries(mockRaceData([skippedHeat]));
    const { updateHeatResult } = mockMutations();
    renderRaceControl();

    await waitFor(() => expect(screen.getByTestId('schedule-management')).toBeInTheDocument());
    await capturedOnRunHeat!(skippedHeat, false);

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
    await capturedOnRunHeat!(freshHeat, false);

    expect(showConfirm).not.toHaveBeenCalled();
    expect(updateHeatResult).not.toHaveBeenCalled();
  });
});
