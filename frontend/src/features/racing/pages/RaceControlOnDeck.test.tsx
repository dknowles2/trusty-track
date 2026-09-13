import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import RaceControl from './RaceControl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';

/**
 * #1084: re-running an earlier heat must not put an already-completed later
 * heat On Deck. `nextExecutionHeat` used to be the positional successor in
 * running order (`sortedHeatsEx[currentIndex + 1]`) — right on the ordinary
 * path, wrong the moment a heat behind the frontier is re-run, since the
 * heat right after the newly-current one may already hold a result.
 *
 * Captures the real `nextExecutionHeat`/`onNextHeat` props `RaceControl`
 * hands to `RaceExecution`, the same shape `RaceControlScheduleConfirm.test.tsx`
 * uses for `ScheduleManagement`'s props.
 */
vi.mock('../components/ScheduleManagement', () => ({
  ScheduleManagement: () => <div data-testid="schedule-management">Schedule Management</div>,
}));

vi.mock('../components/RaceExecution', () => ({
  RaceExecution: ({ activeExecutionHeat, nextExecutionHeat, onNextHeat }: any) => (
    <div data-testid="race-execution">
      <div data-testid="active-heat-id">{activeExecutionHeat?.id ?? 'none'}</div>
      <div data-testid="on-deck-heat-id">{nextExecutionHeat?.id ?? 'none'}</div>
      <div data-testid="has-next-heat">{String(!!nextExecutionHeat)}</div>
      <button onClick={onNextHeat}>Next Heat</button>
    </div>
  ),
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

const mockRaceId = '1';

const ran = (id: number, heatNumber: number) => ({
  id,
  roundId: 10,
  roundNumber: 1,
  heatNumber,
  lanes: [{ lane: 1, racerId: id, placeholderSlot: null, time: 3.5, place: 1, skipped: false }],
});
const notRun = (id: number, heatNumber: number) => ({
  id,
  roundId: 10,
  roundNumber: 1,
  heatNumber,
  lanes: [{ lane: 1, racerId: id, placeholderSlot: null, time: null, place: null, skipped: false }],
});

function withHeats(heats: unknown[]) {
  (useQuery as any).mockReturnValue([{
    data: {
      race: {
        id: 1,
        name: 'Test Race',
        championshipTrophies: 3,
        scoringStrategy: 'TIMED',
        track: { id: 1, laneCount: 4, timerType: 'FAKE' },
        racingGroups: [],
        racers: [],
        heats,
      },
    },
    fetching: false,
    error: null,
  }, vi.fn()]);
}

async function openRaceTab() {
  render(
    <AlertProvider>
      <MemoryRouter initialEntries={[`/race/${mockRaceId}/control`]}>
        <Routes>
          <Route path="/race/:raceId/control/:tab?" element={<RaceControl />} />
        </Routes>
      </MemoryRouter>
    </AlertProvider>
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^\s*Race\s*$/i }));
  await waitFor(() => expect(screen.getByTestId('race-execution')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn().mockResolvedValue({ data: {} })]);
  (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('On Deck after a re-run (#1084)', () => {
  it('skips an already-completed heat and names the next genuinely unfinished one', async () => {
    // Heats 1, 2, 4, 5 have run; heat 3 was just re-run (cleared) and is now
    // the current heat; heat 6 has not run. On Deck must name heat 6, not
    // heat 4 — the positional successor, but already completed.
    withHeats([
      ran(1, 1), ran(2, 2), notRun(3, 3), ran(4, 4), ran(5, 5), notRun(6, 6),
    ]);

    await openRaceTab();

    expect(screen.getByTestId('active-heat-id')).toHaveTextContent('3');
    expect(screen.getByTestId('on-deck-heat-id')).toHaveTextContent('6');
    expect(screen.getByTestId('has-next-heat')).toHaveTextContent('true');
  });

  it('reports no next heat when nothing unfinished remains after the re-run heat', async () => {
    // Same shape, but heat 3 was the last heat in the race — heats 4 and 5
    // already ran and there is nothing after them.
    withHeats([
      ran(1, 1), ran(2, 2), notRun(3, 3), ran(4, 4), ran(5, 5),
    ]);

    await openRaceTab();

    expect(screen.getByTestId('active-heat-id')).toHaveTextContent('3');
    expect(screen.getByTestId('on-deck-heat-id')).toHaveTextContent('none');
    expect(screen.getByTestId('has-next-heat')).toHaveTextContent('false');
  });

  it('Next Heat selects the same unfinished heat On Deck named, not the positional successor', async () => {
    withHeats([
      ran(1, 1), ran(2, 2), notRun(3, 3), ran(4, 4), ran(5, 5), notRun(6, 6),
    ]);

    await openRaceTab();
    expect(screen.getByTestId('active-heat-id')).toHaveTextContent('3');

    fireEvent.click(screen.getByText('Next Heat'));

    await waitFor(() => expect(screen.getByTestId('active-heat-id')).toHaveTextContent('6'));
  });
});
