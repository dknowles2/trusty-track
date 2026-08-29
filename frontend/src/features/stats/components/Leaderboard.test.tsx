// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Leaderboard from './Leaderboard';
import { useQuery, useSubscription } from 'urql';
import { tiedLeaderboardEntries, twoRacerLeaderboardEntries } from '../testFixtures';
import { filenameFor } from '../../../utils/csv';
import { standingsRows, standingsSuffix } from '../standingsExport';

// Mock urql
vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
  };
});

// `downloadCsv` hands the browser a Blob and clicks a synthetic anchor — real
// enough in jsdom, but nothing worth exercising here. Mocked so the export
// test can assert on what was handed to it instead.
vi.mock('../../../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/csv')>();
  return { ...actual, downloadCsv: vi.fn() };
});
import { downloadCsv } from '../../../utils/csv';

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Default no-op subscription mock
beforeEach(() => {
  (useSubscription as any).mockReturnValue([{ data: undefined }, vi.fn()]);
});

describe('Leaderboard', () => {
  const mockData = {
    race: {
      id: 1,
      scoringStrategy: 'TIMED',
      leaderboard: twoRacerLeaderboardEntries,
    }
  };

  it('renders leaderboard rows in the order the server sent them', async () => {
    (useQuery as any).mockReturnValue([{
      data: { race: mockData.race },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: mockData.race.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);

    expect(screen.getByText('Current Standings')).toBeInTheDocument();

    // A header row plus one row per entry — read as rows, not merely as
    // present text, so a component rendering the entries in reverse (or any
    // order but the server's) fails this rather than passing it.
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('John Doe');
    expect(rows[1]).toHaveTextContent('101');
    expect(rows[1]).toHaveTextContent('3.500s');
    expect(rows[2]).toHaveTextContent('Jane Smith');
    expect(rows[2]).toHaveTextContent('102');
    expect(rows[2]).toHaveTextContent('4.200s');
  });

  it('renders a shared rank the same way for both racers who hold it (#226)', () => {
    const tiedData = {
      race: {
        id: 1,
        scoringStrategy: 'TIMED',
        leaderboard: tiedLeaderboardEntries,
      },
    };

    (useQuery as any).mockReturnValue([{
      data: { race: tiedData.race },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: tiedData.race.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    // Both rows carry rank 1 — and so both get the gold-medal styling — rather
    // than one of them silently becoming rank 2.
    expect(rows[1]).toHaveTextContent('🥇 1');
    expect(rows[1]).toHaveTextContent('John Doe');
    expect(rows[2]).toHaveTextContent('🥇 1');
    expect(rows[2]).toHaveTextContent('Jane Smith');
  });

  it('shows non-timed scores correctly (POINTS strategy)', async () => {
    const pointsData = {
      race: {
        id: 1,
        scoringStrategy: 'POINTS',
        leaderboard: [
          {
            racerId: 1,
            firstName: 'John',
            lastName: 'Doe',
            carNumber: 101,
            racingGroupName: 'Tigers',
            score: 5,
            heatsCompleted: 1,
            rank: 1
          }
        ]
      }
    };

    (useQuery as any).mockReturnValue([{
      data: { race: pointsData.race },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: pointsData.race.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);

    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('5.000s')).not.toBeInTheDocument();
  });

  it('shows a racingGroup category beside the racingGroup name when the racingGroup has one (#298, #496 stage 2)', () => {
    const withRacingGroupDivision = {
      race: {
        id: 1,
        scoringStrategy: 'TIMED',
        leaderboard: [
          {
            racerId: 1,
            firstName: 'John',
            lastName: 'Doe',
            carNumber: 101,
            racingGroupName: 'Wolves',
            racingGroupDivision: 'Wolf',
            score: 3.5,
            heatsCompleted: 1,
            rank: 1,
          },
          {
            racerId: 2,
            firstName: 'Jane',
            lastName: 'Smith',
            carNumber: 102,
            racingGroupName: 'Unassigned',
            racingGroupDivision: null,
            score: 4.2,
            heatsCompleted: 1,
            rank: 2,
          },
        ],
      },
    };

    (useQuery as any).mockReturnValue([{
      data: { race: withRacingGroupDivision.race },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: withRacingGroupDivision.race.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);

    expect(screen.getByText('(Wolf)')).toBeInTheDocument();
    // A racingGroup with no division stored gets no label — no stray parentheses.
    expect(screen.queryByText('()')).not.toBeInTheDocument();
  });
});

describe('Leaderboard round scope (issue #17)', () => {
  const entries = [
    {
      racerId: 1, firstName: 'Pre', lastName: 'Lim', carNumber: 1,
      racingGroupName: 'Tigers', score: 3.2, heatsCompleted: 4, rank: 1,
    },
  ];
  const champEntries = [
    {
      racerId: 2, firstName: 'Champ', lastName: 'Winner', carNumber: 2,
      racingGroupName: 'Wolves', score: 2.9, heatsCompleted: 1, rank: 1,
    },
  ];

  const withRounds = (rounds: unknown[]) => ({
    id: 1,
    scoringStrategy: 'TIMED',
    rounds,
  });

  it('shows no scope selector when the race has no championship rounds', () => {
    (useQuery as any).mockReturnValue([{
      data: { race: withRounds([{ id: 1, name: 'Prelim', roundNumber: 1, advancementSource: null }]) },
      fetching: false, error: null,
    }, vi.fn()]);
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: entries }, error: null }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);
    expect(screen.queryByLabelText('Standings scope')).toBeNull();
  });

  it('explains the scope when championship rounds exist', () => {
    (useQuery as any).mockReturnValue([{
      data: { race: withRounds([
        { id: 1, name: 'Prelim', roundNumber: 1, advancementSource: null },
        { id: 2, name: 'Finals', roundNumber: 2, advancementSource: 'ALL' },
      ]) },
      fetching: false, error: null,
    }, vi.fn()]);
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: entries }, error: null }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);
    expect(screen.getByLabelText('Standings scope')).toBeTruthy();
    expect(screen.getByText(/cover the qualifying rounds/i)).toBeTruthy();
    // Only championship rounds are offered — the prelim view is "Overall".
    expect(screen.getByRole('option', { name: 'Finals' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Prelim' })).toBeNull();
  });

  it('renders the round query results once a championship round is picked', async () => {
    const user = userEvent.setup();
    (useQuery as any).mockImplementation(({ pause }: { pause?: boolean }) =>
      pause === true || pause === undefined
        ? [{
            data: { race: withRounds([
              { id: 1, name: 'Prelim', roundNumber: 1, advancementSource: null },
              { id: 2, name: 'Finals', roundNumber: 2, advancementSource: 'ALL' },
            ]) },
            fetching: false, error: null,
          }, vi.fn()]
        : [{ data: { race: { id: 1, leaderboard: champEntries } }, fetching: false, error: null }, vi.fn()]
    );
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: entries }, error: null }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);
    expect(screen.getByText('Pre Lim')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Standings scope'), '2');

    expect(screen.getByText('Champ Winner')).toBeTruthy();
    expect(screen.queryByText('Pre Lim')).toBeNull();
    // The explanatory note belongs to the overall view only.
    expect(screen.queryByText(/cover the qualifying rounds/i)).toBeNull();
  });
});

describe('export and print actions (#173)', () => {
  const race = {
    id: 7,
    name: 'Pack 42 Derby',
    scoringStrategy: 'TIMED',
    rounds: [
      { id: 1, name: 'Prelim', roundNumber: 1, advancementSource: null },
      { id: 2, name: 'Finals', roundNumber: 2, advancementSource: 'ALL' },
    ],
  };
  const overall = [
    { racerId: 1, firstName: 'Pre', lastName: 'Lim', carNumber: 1, racingGroupName: 'Tigers', score: 3.2, heatsCompleted: 4, rank: 1 },
  ];
  const champ = [
    { racerId: 2, firstName: 'Champ', lastName: 'Winner', carNumber: 2, racingGroupName: 'Wolves', score: 2.9, heatsCompleted: 1, rank: 1 },
  ];

  function mockRoundAwareQuery() {
    (useQuery as any).mockImplementation(({ pause }: { pause?: boolean }) =>
      pause === true || pause === undefined
        ? [{ data: { race }, fetching: false, error: null }, vi.fn()]
        : [{ data: { race: { id: race.id, leaderboard: champ } }, fetching: false, error: null }, vi.fn()]
    );
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: overall }, error: null }, vi.fn()]);
  }

  it('exports the overall standings under a filename naming the race', async () => {
    const user = userEvent.setup();
    mockRoundAwareQuery();
    render(<MemoryRouter><Leaderboard raceId={7} /></MemoryRouter>);

    await user.click(screen.getByTestId('export-standings'));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, rows] = (downloadCsv as any).mock.calls[0];
    expect(filename).toBe(filenameFor('Pack 42 Derby', 'standings'));
    expect(rows).toEqual(standingsRows(overall, 'TIMED'));
  });

  it('exports the selected round\'s own standings once one is picked', async () => {
    const user = userEvent.setup();
    mockRoundAwareQuery();
    render(<MemoryRouter><Leaderboard raceId={7} /></MemoryRouter>);

    await user.selectOptions(screen.getByLabelText('Standings scope'), '2');
    await user.click(screen.getByTestId('export-standings'));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, rows] = (downloadCsv as any).mock.calls[0];
    // The filename names the round rather than saying "standings" for both —
    // the overall and a championship round's standings disagree on purpose (#17).
    expect(filename).toBe(filenameFor('Pack 42 Derby', standingsSuffix('Finals')));
    expect(rows).toEqual(standingsRows(champ, 'TIMED'));
  });

  it('points "Print results" at this race\'s printable results page', () => {
    mockRoundAwareQuery();
    render(<MemoryRouter><Leaderboard raceId={7} /></MemoryRouter>);

    expect(screen.getByTestId('print-results')).toHaveAttribute('href', '/race/7/print/results');
  });
});
