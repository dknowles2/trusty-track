// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AlertProvider } from '../../../context/AlertContext';
import Leaderboard from './Leaderboard';
import { useMutation, useQuery, useSubscription } from 'urql';
import {
  podiumLeaderboardEntries,
  tiedLeaderboardEntries,
  twoRacerLeaderboardEntries,
} from '../testFixtures';
import { filenameFor } from '../../../utils/csv';
import { standingsRows, standingsSuffix } from '../standingsExport';

// Mock urql
vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
    // `RunOffControl` (#550), nested under a tied cluster's row, calls
    // `useMutation` — real urql needs a `Provider`, which nothing here sets
    // up.
    useMutation: vi.fn(),
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
  (useMutation as any).mockReturnValue([{ fetching: false }, vi.fn()]);
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

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

  it('notes a DNF beside a TIMED score, without inferring it from the score (#898)', async () => {
    const raceWithDnf = {
      id: 1,
      scoringStrategy: 'TIMED',
      leaderboard: [
        {
          racerId: 1,
          firstName: 'John',
          lastName: 'Doe',
          carNumber: 101,
          racingGroupName: 'Tigers',
          score: 9.999,
          heatsCompleted: 2,
          dnfCount: 1,
          rank: 1,
        },
        {
          // Same score, genuinely — #873/#897's own trap — but no DNF.
          racerId: 2,
          firstName: 'Jane',
          lastName: 'Smith',
          carNumber: 102,
          racingGroupName: 'Wolves',
          score: 9.999,
          heatsCompleted: 2,
          dnfCount: 0,
          rank: 1,
        },
      ],
    };

    (useQuery as any).mockReturnValue([{
      data: { race: raceWithDnf },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: raceWithDnf.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    // The note, not a replacement — both rows still show the score.
    expect(screen.getAllByText('9.999s')).toHaveLength(2);
    expect(screen.getByText('(1 DNF)')).toBeInTheDocument();
  });

  it('shows no DNF note under POINTS, where a DNF already scores last place (#898)', async () => {
    const pointsWithDnf = {
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
          heatsCompleted: 2,
          dnfCount: 1,
          rank: 1,
        },
      ],
    };

    (useQuery as any).mockReturnValue([{
      data: { race: pointsWithDnf },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: pointsWithDnf.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText(/DNF/)).not.toBeInTheDocument();
  });

  it('omits the parenthetical when the division only repeats the group name (#774)', () => {
    // The setup wizard's Cub Scout scaffold gives every den a Category equal
    // to its own name — "Bear" the den, "Bear" the Category — so the raw
    // "name (division)" composition prints "Bear (Bear)" on every row.
    const raceWithRedundantDivision = {
      id: 1,
      scoringStrategy: 'TIMED',
      leaderboard: [
        {
          racerId: 1,
          firstName: 'John',
          lastName: 'Doe',
          carNumber: 101,
          racingGroupName: 'Bear',
          racingGroupDivision: 'Bear',
          score: 3.5,
          heatsCompleted: 1,
          rank: 1,
        },
        {
          racerId: 2,
          firstName: 'Jane',
          lastName: 'Smith',
          carNumber: 102,
          racingGroupName: 'Wolves',
          racingGroupDivision: 'Wolf',
          score: 4.2,
          heatsCompleted: 1,
          rank: 2,
        },
      ],
    };
    (useQuery as any).mockReturnValue([{
      data: { race: raceWithRedundantDivision },
      fetching: false,
      error: null
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: raceWithRedundantDivision.leaderboard },
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    const rows = screen.getAllByRole('row');
    // A division that adds nothing is not printed at all — not even the
    // parentheses.
    expect(rows[1]).toHaveTextContent('Bear');
    expect(rows[1]).not.toHaveTextContent('Bear (Bear)');
    expect(rows[1]).not.toHaveTextContent('(Bear)');
    // A division that genuinely differs from the group's name still shows.
    expect(rows[2]).toHaveTextContent('Wolves (Wolf)');
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    const rows = screen.getAllByRole('row');
    // Header, both tied rows, and the run-off control's own row underneath
    // them (#550) — one per shared rank, offering to settle it.
    expect(rows).toHaveLength(4);
    // Both rows carry rank 1 — and so both get the gold-medal styling — rather
    // than one of them silently becoming rank 2.
    expect(rows[1]).toHaveTextContent('🥇 1');
    expect(rows[1]).toHaveTextContent('John Doe');
    expect(rows[2]).toHaveTextContent('🥇 1');
    expect(rows[2]).toHaveTextContent('Jane Smith');
    expect(screen.getByTestId('start-run-off-btn')).toBeInTheDocument();
  });

  it('marks the top three rows with a podium accent and leaves the rest plain, at normal text colour throughout (#941)', () => {
    const podiumData = {
      race: {
        id: 1,
        scoringStrategy: 'TIMED',
        leaderboard: podiumLeaderboardEntries,
      },
    };

    (useQuery as any).mockReturnValue([{
      data: { race: podiumData.race },
      fetching: false,
      error: null,
    }, vi.fn()]);

    (useSubscription as any).mockReturnValue([{
      data: { leaderboard: podiumData.race.leaderboard },
      fetching: false,
      error: null,
    }, vi.fn()]);

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    const rankCells = screen.getAllByTestId('leaderboard-rank-cell');
    expect(rankCells).toHaveLength(4);

    // The old full-row fill (#ffd700/#c0c0c0/#cd7f32) is gone entirely —
    // rows 1-3 get a 4px accent border on the Rank cell instead, in the
    // medal colour; row 4 gets the same width, transparent, so nothing
    // shifts. None of the literal hex values from before this fix should
    // ever reappear.
    expect(rankCells[0].getAttribute('style')).toContain('border-left: 4px solid var(--rank-gold-color)');
    expect(rankCells[1].getAttribute('style')).toContain('border-left: 4px solid var(--rank-silver-icon-color)');
    expect(rankCells[2].getAttribute('style')).toContain('border-left: 4px solid var(--rank-bronze-icon-color)');
    expect(rankCells[3].getAttribute('style')).toContain('border-left: 4px solid transparent');

    const rows = screen.getAllByRole('row');
    // Header row, then the four podium rows.
    expect(rows).toHaveLength(5);
    const oldLiterals = /#(ffd700|c0c0c0|cd7f32)/i;
    for (const row of rows.slice(1)) {
      // The row itself carries no background any more — the wash is gone,
      // and nothing (row or cell) still names the old literal hex values.
      expect(row.getAttribute('style') ?? '').not.toMatch(oldLiterals);
      expect((row as HTMLElement).style.background).toBe('');
      for (const cell of Array.from(row.querySelectorAll('td'))) {
        const style = (cell as HTMLElement).getAttribute('style') ?? '';
        expect(style).not.toMatch(oldLiterals);
        // Every cell stays at the table's ordinary text colour — no cell's
        // `color` is set as a function of rank any more.
        expect((cell as HTMLElement).style.color).not.toMatch(oldLiterals);
      }
    }
  });

  // #766: the metadata query now carries the track's laneCount and
  // laneOutages so RunOffControl can disable "Start run-off" for a cluster
  // wider than the track can actually race, before the operator ever
  // clicks it.
  it("passes the track's usable lane count through to RunOffControl (#766)", () => {
    const tiedData = {
      race: {
        id: 1,
        scoringStrategy: 'TIMED',
        leaderboard: tiedLeaderboardEntries,
        // One usable lane (2, less lane 2 out of service) for two tied
        // racers — not enough to race them off against each other.
        track: { id: 9, laneCount: 2, laneOutages: [2] },
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    const button = screen.getByTestId('start-run-off-btn');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Not enough usable lanes for all 2 tied racers (only 1 available).',
    );
  });

  it('says how a resolved tie was broken, and stops sharing the rank (#540)', () => {
    const resolvedData = {
      race: {
        id: 1,
        scoringStrategy: 'TIMED',
        leaderboard: [
          { ...tiedLeaderboardEntries[0], rank: 1, resolvedBy: 'BEST_TIME' },
          { ...tiedLeaderboardEntries[1], rank: 2, resolvedBy: 'BEST_TIME' },
        ],
      },
    };

    (useQuery as any).mockReturnValue([
      { data: { race: resolvedData.race }, fetching: false, error: null },
      vi.fn(),
    ]);
    (useSubscription as any).mockReturnValue([
      { data: { leaderboard: resolvedData.race.leaderboard }, fetching: false, error: null },
      vi.fn(),
    ]);

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('🥇 1');
    expect(rows[1]).toHaveTextContent('1st, on fastest single heat');
    expect(rows[2]).toHaveTextContent('2');
    expect(rows[2]).not.toHaveTextContent('🥇');
    expect(rows[2]).toHaveTextContent('2nd, on fastest single heat');
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);

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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);
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

    render(<AlertProvider><MemoryRouter><Leaderboard raceId={1} /></MemoryRouter></AlertProvider>);
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
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={7} /></MemoryRouter></AlertProvider>);

    await user.click(screen.getByTestId('export-standings'));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, rows] = (downloadCsv as any).mock.calls[0];
    expect(filename).toBe(filenameFor('Pack 42 Derby', 'standings'));
    expect(rows).toEqual(standingsRows(overall, 'TIMED'));
  });

  it('exports the selected round\'s own standings once one is picked', async () => {
    const user = userEvent.setup();
    mockRoundAwareQuery();
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={7} /></MemoryRouter></AlertProvider>);

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
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={7} /></MemoryRouter></AlertProvider>);

    expect(screen.getByTestId('print-results')).toHaveAttribute('href', '/race/7/print/results');
  });
});

describe('the drop-worst-runs indicator (#547 stage 3)', () => {
  const raceWithDrop = {
    id: 9,
    name: 'Pack 42 Derby',
    scoringStrategy: 'POINTS',
    dropWorstRuns: 1,
    rounds: [
      { id: 1, name: 'Prelim', roundNumber: 1, advancementSource: null },
      {
        id: 2,
        name: 'Semis',
        roundNumber: 2,
        advancementSource: null,
        schedulingStrategy: 'ELIMINATION',
        eliminationLosses: 3,
      },
    ],
  };
  const entry = (dropWorstRunsApplied: boolean) => ({
    racerId: 1,
    firstName: 'Alex',
    lastName: 'One',
    carNumber: 1,
    racingGroupName: 'Tigers',
    score: 4,
    heatsCompleted: 3,
    rank: 1,
    dropWorstRunsApplied,
  });

  function mockDropWorstQuery(overallEntries: unknown[], eliminationEntries: unknown[] = []) {
    (useQuery as any).mockImplementation(({ pause }: { pause?: boolean }) =>
      pause === true || pause === undefined
        ? [{ data: { race: raceWithDrop }, fetching: false, error: null }, vi.fn()]
        : [
            { data: { race: { id: raceWithDrop.id, leaderboard: eliminationEntries } }, fetching: false, error: null },
            vi.fn(),
          ],
    );
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: overallEntries }, error: null }, vi.fn()]);
  }

  it('warns when the modifier is configured but did not fire', () => {
    mockDropWorstQuery([entry(false)]);
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={9} /></MemoryRouter></AlertProvider>);

    expect(screen.getByText(/Drop the worst 1 run is on/)).toBeInTheDocument();
  });

  it('says nothing once the modifier actually applied', () => {
    mockDropWorstQuery([entry(true)]);
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={9} /></MemoryRouter></AlertProvider>);

    expect(screen.queryByText(/Drop the worst/)).toBeNull();
  });

  it("says nothing on an elimination round's own standings, where the modifier never applies", async () => {
    const user = userEvent.setup();
    mockDropWorstQuery([entry(false)], [entry(false)]);
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={9} /></MemoryRouter></AlertProvider>);

    await user.selectOptions(screen.getByLabelText('Standings scope'), '2');

    expect(screen.queryByText(/Drop the worst/)).toBeNull();
  });
});

describe('an elimination-only race defaults away from the empty Overall view (#1020)', () => {
  const eliminationOnlyRace = {
    id: 11,
    name: 'Elimination Derby',
    scoringStrategy: 'TIMED',
    rounds: [
      {
        id: 5,
        name: 'Elimination Round',
        roundNumber: 1,
        advancementSource: null,
        schedulingStrategy: 'ELIMINATION',
        eliminationLosses: 3,
      },
    ],
  };
  const winner = [
    {
      racerId: 3,
      firstName: 'Sam',
      lastName: 'Survivor',
      carNumber: 9,
      racingGroupName: 'Wolves',
      score: 0,
      heatsCompleted: 4,
      rank: 1,
    },
  ];

  function mockEliminationOnlyQuery() {
    (useQuery as any).mockImplementation(({ pause }: { pause?: boolean }) =>
      pause === true || pause === undefined
        ? [{ data: { race: eliminationOnlyRace }, fetching: false, error: null }, vi.fn()]
        : [
            { data: { race: { id: eliminationOnlyRace.id, leaderboard: winner } }, fetching: false, error: null },
            vi.fn(),
          ],
    );
    // The prelim-scoped subscription never carries anything for an
    // elimination-only race — that is the whole bug.
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: [] }, error: null }, vi.fn()]);
  }

  it('lands the selector on the elimination round with no click, and shows its winner', () => {
    mockEliminationOnlyQuery();
    const { container } = render(
      <AlertProvider><MemoryRouter><Leaderboard raceId={11} /></MemoryRouter></AlertProvider>,
    );

    expect(screen.getByLabelText('Standings scope')).toHaveValue('5');
    expect(container.querySelector('h2')?.textContent).toContain('Elimination Round');
    expect(screen.getByText('Sam Survivor')).toBeInTheDocument();
    // The championship banner never applies to this race shape.
    expect(screen.queryByText(/cover the qualifying rounds/i)).toBeNull();
  });

  it('does not fight an operator who deliberately switches back to Overall', async () => {
    const user = userEvent.setup();
    mockEliminationOnlyQuery();
    render(<AlertProvider><MemoryRouter><Leaderboard raceId={11} /></MemoryRouter></AlertProvider>);

    expect(screen.getByLabelText('Standings scope')).toHaveValue('5');

    await user.selectOptions(screen.getByLabelText('Standings scope'), '');

    expect(screen.getByLabelText('Standings scope')).toHaveValue('');
    // Overall really is empty for this race shape, and says why rather than
    // suggesting more heats would fix it.
    expect(
      screen.getByText('This race is scored by elimination — pick Elimination Round above.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cover the qualifying rounds/i)).toBeNull();
  });
});
