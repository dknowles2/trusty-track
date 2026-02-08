import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleManagement } from './ScheduleManagement';
import { AlertProvider } from '../../context/AlertContext';

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

// Mock apiClient
vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({})), // Default empty response
    post: vi.fn(),
    put: vi.fn(),
  }
}));

import { apiClient } from '../../api/client';

describe('ScheduleManagement', () => {
    const mockHeats = [
        { id: 1, round_number: 1, round_id: 1, heat_number: 1, lane_results: '[]' },
        { id: 2, round_number: 1, round_id: 1, heat_number: 2, lane_results: '[]' }
    ];
    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnAddRound = vi.fn();
    const mockOnRegenerateRound = vi.fn();
    const mockOnRunHeat = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                />
            </AlertProvider>
        );

        // Verify DndContext and SortableContext are rendered
        expect(screen.getByTestId('dnd-context')).toBeInTheDocument();
        expect(screen.getByTestId('sortable-context')).toBeInTheDocument();
    });

    it('displays heats sorted by heat_number', () => {
        const unsortedHeats = [
            { id: 3, round_number: 1, round_id: 1, heat_number: 3, lane_results: '[]' },
            { id: 1, round_number: 1, round_id: 1, heat_number: 1, lane_results: '[]' },
            { id: 2, round_number: 1, round_id: 1, heat_number: 2, lane_results: '[]' },
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                />
            </AlertProvider>
        );

        const heatElements = screen.getAllByText(/Heat \d/);
        expect(heatElements[0]).toHaveTextContent('Heat 1');
        expect(heatElements[1]).toHaveTextContent('Heat 2');
        expect(heatElements[2]).toHaveTextContent('Heat 3');
    });

    it('groups heats by round correctly', () => {
        const multiRoundHeats = [
            ...mockHeats,
            { id: 3, round_number: 2, round_id: 2, heat_number: 1, lane_results: '[]' },
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
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
        
        expect(mockOnAddRound).toHaveBeenCalledWith('PPC', 'Semi-Finals');
    });

    it('displays custom round name', () => {
        const namedRoundHeats = [
            { id: 1, round_number: 1, round_name: 'Semi-Finals', round_id: 1, heat_number: 1, lane_results: '[]' },
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
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                />
            </AlertProvider>
        );

        expect(screen.getByText('Semi-Finals')).toBeInTheDocument();
        expect(screen.queryByText('Round 1')).not.toBeInTheDocument();
    });

    it('hides regenerate button for championship rounds', async () => {
        const roundId = 1;
        const heats = [
            { id: 1, round_number: 1, round_id: roundId, heat_number: 1, lane_results: '[{"racer_id": -1, "lane": 1}]' }, // Needs placeholder to trigger fetch
        ];

        // Mock apiClient to return advancement status for this round
        (apiClient.get as any).mockImplementation((url: string) => {
            if (url.endsWith('advancement_status')) {
                return Promise.resolve({
                    already_advanced: false,
                    is_ready: true,
                    advancing_racers: []
                });
            }
            return Promise.resolve({});
        });

        render(
            <AlertProvider>
                <ScheduleManagement 
                    raceId={1}
                    heats={heats} 
                    generating={false} 
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onRunHeat={mockOnRunHeat}
                    getRacerName={mockGetRacerName}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    denCount={3}
                />
            </AlertProvider>
        );

        // Verify API was called
        // We know it might take a tick, so we wait or expect
        
        // Wait for usage of useEffect
        await screen.findByText(/Auto-Advancement Pending/i);

        // Check that regenerate button is NOT present
        expect(screen.queryByText('Regenerate')).not.toBeInTheDocument();
    });
});

