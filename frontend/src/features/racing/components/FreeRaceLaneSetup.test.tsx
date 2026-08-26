import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery } from 'urql';
import { FreeRaceLaneSetup, Mode } from './FreeRaceLaneSetup';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

const mockRandomLanes = [
  { lane: 1, racerId: 101 },
  { lane: 2, racerId: 102 },
  { lane: 3, racerId: null },
  { lane: 4, racerId: null },
];

const mockRacers = [
  { id: 101, firstName: 'Alice', lastName: 'Smith', carNumber: 7, carPassedInspection: true },
  { id: 102, firstName: 'Bob', lastName: 'Jones', carNumber: 12, carPassedInspection: true },
  { id: 103, firstName: 'Carol', lastName: 'White', carNumber: 5, carPassedInspection: false },
];

const StatefulWrapper: React.FC<any> = (props) => {
  const [mode, setMode] = React.useState<Mode>('random');
  return <FreeRaceLaneSetup {...props} mode={mode} onModeChange={setMode} />;
};

describe('FreeRaceLaneSetup', () => {
  const mockOnStart = vi.fn();
  const mockReExecute = vi.fn();

  const racersMap: Record<number, any> = {};
  mockRacers.forEach(r => { racersMap[r.id] = r; });

  const defaultProps = {
    raceId: 1,
    laneCount: 4,
    onStart: mockOnStart,
    racers: racersMap,
    timerType: 'FAKE',
  };

  const mockData = { randomFreeRaceLanes: mockRandomLanes };
  const mockResult = { data: mockData, fetching: false };
  const emptyResult = { data: null, fetching: false };

  beforeEach(() => {
    vi.clearAllMocks();
    (useQuery as any).mockImplementation(({ query }: any) => {
      if (query.includes('randomFreeRaceLanes')) {
        return [mockResult, mockReExecute];
      }
      return [emptyResult, vi.fn()];
    });
  });

  it('renders in random mode by default', () => {
    render(<StatefulWrapper {...defaultProps} />);
    // The Random tab button should be present and visually selected (bold)
    expect(screen.getByRole('button', { name: /Random/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manual/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anonymous/i })).toBeInTheDocument();
  });

  it('displays lane assignments returned by the randomFreeRaceLanes query', async () => {
    render(<StatefulWrapper {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Lane 1')).toBeInTheDocument();
      expect(screen.getByText('Lane 2')).toBeInTheDocument();
      expect(screen.getByText('Lane 3')).toBeInTheDocument();
      expect(screen.getByText('Lane 4')).toBeInTheDocument();
    });
    // Racer Names are shown in random mode
    expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Jones/)).toBeInTheDocument();
  });

  it('Re-shuffle asks the server for the next draw, not the same one again', async () => {
    // The draw may be seeded (`demo_seed`), and a key naming only the race
    // gives every draw the same answer — which is the public demo, where
    // re-fetching the identical query left the lanes untouched. The counter is
    // a query variable so a re-shuffle asks a different question.
    const seen: unknown[] = [];
    (useQuery as any).mockImplementation(({ query, variables }: any) => {
      if (query.includes('randomFreeRaceLanes')) {
        seen.push(variables);
        return [mockResult, mockReExecute];
      }
      return [emptyResult, vi.fn()];
    });

    render(<StatefulWrapper {...defaultProps} />);
    expect(seen[seen.length - 1]).toEqual({ raceId: 1, shuffle: 0 });

    fireEvent.click(screen.getByRole('button', { name: /Re-shuffle/i }));
    expect(seen[seen.length - 1]).toEqual({ raceId: 1, shuffle: 1 });

    fireEvent.click(screen.getByRole('button', { name: /Re-shuffle/i }));
    expect(seen[seen.length - 1]).toEqual({ raceId: 1, shuffle: 2 });
  });

  it('a new draw replaces the lanes on screen', async () => {
    const first = { data: { randomFreeRaceLanes: mockRandomLanes }, fetching: false };
    const second = {
      data: {
        randomFreeRaceLanes: [
          { lane: 1, racerId: 102 },
          { lane: 2, racerId: 101 },
        ],
      },
      fetching: false,
    };
    (useQuery as any).mockImplementation(({ query, variables }: any) => {
      if (query.includes('randomFreeRaceLanes')) {
        return [variables.shuffle === 0 ? first : second, mockReExecute];
      }
      return [emptyResult, vi.fn()];
    });

    render(<StatefulWrapper {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/Alice Smith/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Re-shuffle/i }));

    await waitFor(() => {
      const lanes = screen.getAllByText(/Alice Smith|Bob Jones/).map((e) => e.textContent);
      expect(lanes).toEqual(['Bob Jones', 'Alice Smith']);
    });
  });

  it('switching to Manual mode shows a dropdown for each lane', async () => {
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      // One select per lane
      const selects = screen.getAllByRole('combobox');
      expect(selects).toHaveLength(4);
    });
  });

  it('Manual mode dropdowns exclude already-selected racers', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });

    // Assign Alice (101) to lane 1
    const selects = screen.getAllByRole('combobox');

    // Focus and select Alice
    await user.click(selects[0]);
    await user.type(selects[0], 'Alice');
    const aliceOption = screen.getByText(/#7 Alice Smith/);
    await user.click(aliceOption);

    // Lane 2's dropdown should NOT include Alice as an available option
    await user.click(selects[1]);
    expect(screen.queryByText(/#7 Alice Smith/)).not.toBeInTheDocument();
    // But should include Bob
    expect(screen.getByText(/#12 Bob Jones/)).toBeInTheDocument();
  });

  it('Manual mode only shows checked-in racers', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[0]);

    // Carol is NOT checked in, but we now show all racers in Manual mode
    expect(screen.getByText(/Carol White/)).toBeInTheDocument();
  });

  it('Start is enabled when the draw comes back with every lane empty', async () => {
    const emptyLanesData = {
      data: {
        randomFreeRaceLanes: [
          { lane: 1, racerId: null },
          { lane: 2, racerId: null },
        ],
      },
      fetching: false,
    };
    (useQuery as any).mockImplementation(() => [emptyLanesData, mockReExecute]);
    render(<StatefulWrapper {...defaultProps} />);
    const startBtn = screen.getByRole('button', { name: /Start (Free Race|Anonymous) Heat/i });
    expect(startBtn).not.toBeDisabled();
  });

  it('Anonymous mode gives every lane on the track an empty lane and no picker', async () => {
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Anonymous/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/No racer/i)).toHaveLength(4);
    });
    expect(screen.getByText('Lane 4')).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // The draw's racers belong to the other modes, not this one.
    expect(screen.queryByText(/Alice Smith/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Start Anonymous Heat/i })
    ).toBeInTheDocument();
  });

  it('Anonymous mode starts a heat with every lane empty', async () => {
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Anonymous/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/No racer/i)).toHaveLength(4);
    });

    fireEvent.click(screen.getByRole('button', { name: /Start Anonymous Heat/i }));
    expect(mockOnStart).toHaveBeenCalledWith([
      { id: 'anonymous-1', lane: 1, racerId: null },
      { id: 'anonymous-2', lane: 2, racerId: null },
      { id: 'anonymous-3', lane: 3, racerId: null },
      { id: 'anonymous-4', lane: 4, racerId: null },
    ]);
  });

  it('Start Free Race Heat calls onStart with correct LaneAssignment array in random mode', async () => {
    render(<StatefulWrapper {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Start (Free Race|Anonymous) Heat/i }));
    expect(mockOnStart).toHaveBeenCalledWith([
      { id: 'random-1', lane: 1, racerId: 101 },
      { id: 'random-2', lane: 2, racerId: 102 },
      { id: 'random-3', lane: 3, racerId: null },
      { id: 'random-4', lane: 4, racerId: null },
    ]);
  });

  it('Start Free Race Heat calls onStart with correct assignments in manual mode', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<StatefulWrapper {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });

    // Assign Alice to lane 1
    const selects = screen.getAllByRole('combobox');
    await user.click(selects[0]);
    await user.type(selects[0], 'Alice');
    const aliceOption = screen.getByText(/#7 Alice Smith/);
    await user.click(aliceOption);

    fireEvent.click(screen.getByRole('button', { name: /Start (Free Race|Anonymous) Heat/i }));
    expect(mockOnStart).toHaveBeenCalledWith(
      expect.arrayContaining([{ id: 'manual-1', lane: 1, racerId: 101 }])
    );
  });

  it('displays the results-do-not-affect-standings banner', () => {
    render(<StatefulWrapper {...defaultProps} />);
    expect(screen.getByText(/results do not affect standings/i)).toBeInTheDocument();
  });
});
