// @vitest-environment jsdom
import '../../../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Leaderboard from './Leaderboard';
import { useQuery, useSubscription } from 'urql';

// Mock urql
vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useSubscription: vi.fn(),
  };
});

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
      leaderboard: [
        {
          racerId: 1,
          firstName: 'John',
          lastName: 'Doe',
          carNumber: 101,
          denName: 'Tigers',
          score: 3.5,
          heatsCompleted: 1,
          rank: 1,
          racerImageUrl: 'http://example.com/racer.jpg'
        },
        {
          racerId: 2,
          firstName: 'Jane',
          lastName: 'Smith',
          carNumber: 102,
          denName: 'Wolves',
          score: 4.2,
          heatsCompleted: 1,
          rank: 2
        }
      ]
    }
  };

  it('renders leaderboard data correctly', async () => {
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
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.getByText('3.500s')).toBeInTheDocument();
    expect(screen.getByText('4.200s')).toBeInTheDocument();
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
            denName: 'Tigers',
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
});

describe('Leaderboard round scope (issue #17)', () => {
  const entries = [
    {
      racerId: 1, firstName: 'Pre', lastName: 'Lim', carNumber: 1,
      denName: 'Tigers', score: 3.2, heatsCompleted: 4, rank: 1,
    },
  ];
  const champEntries = [
    {
      racerId: 2, firstName: 'Champ', lastName: 'Winner', carNumber: 2,
      denName: 'Wolves', score: 2.9, heatsCompleted: 1, rank: 1,
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
        { id: 2, name: 'Finals', roundNumber: 2, advancementSource: 'PACK' },
      ]) },
      fetching: false, error: null,
    }, vi.fn()]);
    (useSubscription as any).mockReturnValue([{ data: { leaderboard: entries }, error: null }, vi.fn()]);

    render(<MemoryRouter><Leaderboard raceId={1} /></MemoryRouter>);
    expect(screen.getByLabelText('Standings scope')).toBeTruthy();
    expect(screen.getByText(/cover the preliminary rounds/i)).toBeTruthy();
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
              { id: 2, name: 'Finals', roundNumber: 2, advancementSource: 'PACK' },
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
    expect(screen.queryByText(/cover the preliminary rounds/i)).toBeNull();
  });
});
