// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

    render(<Leaderboard raceId={1} />);

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

    render(<Leaderboard raceId={1} />);

    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('5.000s')).not.toBeInTheDocument();
  });
});
