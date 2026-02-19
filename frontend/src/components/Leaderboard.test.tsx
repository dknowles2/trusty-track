// @vitest-environment jsdom
import '../setupTests';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
      data: mockData,
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

  it('calls reExecute when raceStateChanged subscription fires', async () => {
    const mockReExecute = vi.fn();
    let capturedHandler: ((prev: any, data: any) => any) | undefined;

    (useQuery as any).mockReturnValue([{
      data: mockData,
      fetching: false,
      error: null
    }, mockReExecute]);

    (useSubscription as any).mockImplementation(
      (_opts: any, handler: (prev: any, data: any) => any) => {
        capturedHandler = handler;
        return [{ data: undefined }, vi.fn()];
      }
    );

    render(<Leaderboard raceId={1} />);

    await waitFor(() => {
      expect(capturedHandler).toBeDefined();
    });

    act(() => {
      capturedHandler!(undefined, { raceStateChanged: { raceId: 1, changedAt: '2026-01-01T00:00:00Z' } });
    });

    expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
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
      data: pointsData,
      fetching: false,
      error: null
    }, vi.fn()]);

    render(<Leaderboard raceId={1} />);

    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('5.000s')).not.toBeInTheDocument();
  });
});
