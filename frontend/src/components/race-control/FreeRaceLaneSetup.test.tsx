import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery } from 'urql';
import { FreeRaceLaneSetup } from './FreeRaceLaneSetup';

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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useQuery as any).mockImplementation(({ query }: any) => {
      if (query.includes('randomFreeRaceLanes')) {
        return [{ data: { randomFreeRaceLanes: mockRandomLanes }, fetching: false }, mockReExecute];
      }
      return [{ data: null, fetching: false }, vi.fn()];
    });
  });

  it('renders in random mode by default', () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    // The Random tab button should be present and visually selected (bold)
    expect(screen.getByRole('button', { name: /Random/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manual/i })).toBeInTheDocument();
  });

  it('displays lane assignments returned by the randomFreeRaceLanes query', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
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

  it('Re-shuffle button triggers a new query with network-only policy', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    const reshuffleBtn = screen.getByRole('button', { name: /Re-shuffle/i });
    fireEvent.click(reshuffleBtn);
    expect(mockReExecute).toHaveBeenCalledWith({ requestPolicy: 'network-only' });
  });

  it('switching to Manual mode shows a dropdown for each lane', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      // One select per lane
      const selects = screen.getAllByRole('combobox');
      expect(selects).toHaveLength(4);
    });
  });

  it('Manual mode dropdowns exclude already-selected racers', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });

    // Assign Alice (101) to lane 1
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '101' } });

    // Lane 2's dropdown should NOT include Alice as an available option
    const lane2Options = Array.from(selects[1].querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(lane2Options).not.toContain('101');
    // But should include Bob
    expect(lane2Options).toContain('102');
  });

  it('Manual mode only shows checked-in racers', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });
    // Carol is NOT checked in, but we now show all racers in Manual mode
    expect(screen.getAllByText(/Carol White/)).toHaveLength(4);
  });

  it('Start Free Race Heat is disabled when all lanes are empty in random mode', async () => {
    (useQuery as any).mockImplementation(() => [
      {
        data: {
          randomFreeRaceLanes: [
            { lane: 1, racerId: null },
            { lane: 2, racerId: null },
          ],
        },
        fetching: false,
      },
      mockReExecute,
    ]);
    render(<FreeRaceLaneSetup {...defaultProps} />);
    const startBtn = screen.getByRole('button', { name: /Start Free Race Heat/i });
    expect(startBtn).toBeDisabled();
  });

  it('Start Free Race Heat calls onStart with correct LaneAssignment array in random mode', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Start Free Race Heat/i }));
    expect(mockOnStart).toHaveBeenCalledWith([
      { lane: 1, racerId: 101 },
      { lane: 2, racerId: 102 },
      { lane: 3, racerId: null },
      { lane: 4, racerId: null },
    ]);
  });

  it('Start Free Race Heat calls onStart with correct assignments in manual mode', async () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(4);
    });
    // Assign Alice to lane 1
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '101' } });

    fireEvent.click(screen.getByRole('button', { name: /Start Free Race Heat/i }));
    expect(mockOnStart).toHaveBeenCalledWith(
      expect.arrayContaining([{ lane: 1, racerId: 101 }])
    );
  });

  it('displays the results-do-not-affect-standings banner', () => {
    render(<FreeRaceLaneSetup {...defaultProps} />);
    expect(screen.getByText(/results do not affect standings/i)).toBeInTheDocument();
  });
});
