import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleManagement, Heat } from './ScheduleManagement';
import { AlertProvider } from '../../context/AlertContext';
import { useMutation } from 'urql';

// Mock urql
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useQuery: vi.fn(),
        useMutation: vi.fn(() => [{ fetching: false }, vi.fn()]),
    };
});

// Mock @dnd-kit modules
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div data-testid="dnd-context">{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: (arr: any[], oldIndex: number, newIndex: number) => {
    const newArr = [...arr];
    const [removed] = newArr.splice(oldIndex, 1);
    newArr.splice(newIndex, 0, removed);
    return newArr;
  },
  SortableContext: ({ children }: any) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

describe('ScheduleManagement', () => {
    const mockHeats: Heat[] = [
        { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'Round 1' },
        { id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, laneResults: '[]', roundName: 'Round 1' }
    ];
    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnAddRound = vi.fn();
    const mockOnRegenerateRound = vi.fn();
    const mockOnDeleteRound = vi.fn();
    const mockOnRunHeat = vi.fn();
    const mockOnReorderHeats = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
    });

    it('renders the add round button', () => {
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={[]} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        expect(screen.getByText('Add Round')).toBeInTheDocument();
    });

    it('displays heats grouped by round', () => {
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={mockHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        expect(screen.getByText('1 Round')).toBeInTheDocument();
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('Heat 2')).toBeInTheDocument();
    });

    it('opens modal when add round button is clicked', () => {
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={[]} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        fireEvent.click(screen.getByText('Add Round'));
        // Modal should open - check for modal content (Round Name input is a good proxy)
        expect(screen.getByLabelText(/Round Name/i)).toBeInTheDocument();
    });

    it('calls onRunHeat when run button is clicked', () => {
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={mockHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        const runButtons = screen.getAllByText('Run');
        fireEvent.click(runButtons[0]);
        expect(mockOnRunHeat).toHaveBeenCalled();
    });

    // Heat reordering tests
    it('renders drag-and-drop context for heat reordering', () => {
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={mockHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );

        // Verify DndContext and SortableContext are rendered
        expect(screen.getByTestId('dnd-context')).toBeInTheDocument();
        expect(screen.getByTestId('sortable-context')).toBeInTheDocument();
    });

    it('displays heats sorted by heat_number', () => {
        const unsortedHeats: Heat[] = [
            { id: 3, roundNumber: 1, roundId: 1, heatNumber: 3, laneResults: '[]', roundName: 'Round 1' },
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'Round 1' },
            { id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, laneResults: '[]', roundName: 'Round 1' },
        ];

        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={unsortedHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );

        const heatElements = screen.getAllByText(/Heat \d/);
        expect(heatElements[0]).toHaveTextContent('Heat 1');
        expect(heatElements[1]).toHaveTextContent('Heat 2');
        expect(heatElements[2]).toHaveTextContent('Heat 3');
    });

    it('groups heats by round correctly', () => {
        const multiRoundHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'Round 1' },
            { id: 3, roundNumber: 2, roundId: 2, heatNumber: 1, laneResults: '[]', roundName: 'Round 2' },
        ];

        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={multiRoundHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );

        expect(screen.getByText('Round 1')).toBeInTheDocument();
        expect(screen.getByText('Round 2')).toBeInTheDocument();
    });

    it('calls onAddRound with name when provided', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={[]} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        
        // Open modal
        await user.click(screen.getByText('Add Round'));
        
        // Fill name
        const nameInput = screen.getByLabelText(/Round Name/i);
        await user.type(nameInput, 'Semi-Finals');
        
        // Submit
        await user.click(screen.getByRole('button', { name: /Create Round/i }));
        
        expect(mockOnAddRound).toHaveBeenCalledWith({
            name: 'Semi-Finals',
            schedulingStrategy: 'PPC',
            advancementSource: undefined,
            advancementNumRacers: undefined,
            runsPerLane: 1,
            generalType: 'PACK'
        });
    });

    it('displays custom round name', () => {
        const namedRoundHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundName: 'Semi-Finals', roundId: 1, heatNumber: 1, laneResults: '[]' },
        ];

        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={namedRoundHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );

        expect(screen.getByText('Semi-Finals')).toBeInTheDocument();
        expect(screen.queryByText('Round 1')).not.toBeInTheDocument();
    });

    it('disables add round button if final round exists', () => {
        // The check for "final" in name is simple string match as per component logic
        const finalHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'Final Round' },
        ];
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={finalHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        const addBtn = screen.getByRole('button', { name: /Add Round/i });
        expect(addBtn).toBeDisabled();
    });

    it('calls onDeleteRound when delete button is clicked', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        const roundHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'Round 1' },
        ];
        
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={roundHeats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        
        const deleteBtn = screen.getByLabelText(/delete round 1/i);
        await user.click(deleteBtn);
        
        expect(mockOnDeleteRound).toHaveBeenCalledWith(1);
    });

    it('disables delete button if round has results', () => {
        const heatsWithResults: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[{"racer_id": 1, "lane": 1, "time": 3.45}]', roundName: 'Round 1' },
        ];
        
        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={heatsWithResults} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onRunHeat={mockOnRunHeat}
                    onReorderHeats={mockOnReorderHeats}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                    championshipTrophies={3}
                />
            </AlertProvider>
        );
        
        const deleteBtn = screen.getByLabelText(/delete round 1/i);
        expect(deleteBtn).toBeDisabled();
        expect(deleteBtn).toHaveAttribute('title', 'Cannot delete round: it has heats with results');
  });

  it('disables delete button for general round if championship round exists', () => {
    const multiRoundHeats: Heat[] = [
      { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, laneResults: '[]', roundName: 'General' },
      { id: 2, roundNumber: 2, roundId: 2, heatNumber: 1, laneResults: '[]', roundName: 'Finals' },
    ];
    
    render(
      <AlertProvider>
        <ScheduleManagement 
          raceId={1}
          heats={multiRoundHeats} 
          generating={false} 
          activeHeatId={null}
          onAddRound={mockOnAddRound}
          onRegenerateRound={mockOnRegenerateRound}
          onDeleteRound={mockOnDeleteRound}
          onRunHeat={mockOnRunHeat}
          onReorderHeats={mockOnReorderHeats}
          getRacerName={mockGetRacerName}
          onRefetchHeats={vi.fn()}
          laneCount={4}
          racerCount={10}
          denCount={3}
          championshipTrophies={3}
        />
      </AlertProvider>
    );
    
    const deleteBtn = screen.getByLabelText(/delete general/i);
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('title', 'Cannot delete general round: championship rounds are already scheduled');
  });
});
