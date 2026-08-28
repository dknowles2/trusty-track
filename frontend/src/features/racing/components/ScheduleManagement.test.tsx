import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DragEndEvent } from '@dnd-kit/core';
import { ScheduleManagement, Heat } from './ScheduleManagement';
import { lane } from '../testFixtures';
import { AlertProvider } from '../../../context/AlertContext';
import { MemoryRouter } from 'react-router-dom';

// `useMutation` is mocked because `RoundWizard` — unconditionally mounted by
// `ScheduleManagement`, gated only on visibility — calls it, and these tests
// render with no urql `Provider`. `useQuery` is deliberately left un-mocked:
// nothing ScheduleManagement renders calls it, so a component that started
// querying here would hit the real hook with no provider and fail loudly,
// rather than silently reading `undefined` from a stub nobody configured.
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useMutation: vi.fn(() => [{ fetching: false }, vi.fn()]),
    };
});

// `@dnd-kit` still can't run a real pointer/keyboard drag under jsdom, so the
// mechanics stay stubbed — but `DndContext`'s mock now captures the
// `onDragEnd` callback ScheduleManagement passes it, so a test can invoke the
// component's own reorder logic directly instead of only asserting static
// render output. `arrayMove` is dnd-kit's real, published implementation
// (splice out, splice in), not a fake — reproducing it here isn't mocking
// away the behavior under test.
const dragEndHandlers = vi.hoisted<Array<(event: DragEndEvent) => void>>(() => []);

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => {
    dragEndHandlers.push(onDragEnd);
    return <>{children}</>;
  },
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
  SortableContext: ({ children }: any) => <>{children}</>,
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
        { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
        { id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, lanes: [], roundName: 'Round 1' }
    ];
    const mockGetRacerName = vi.fn((id) => `Racer ${id}`);
    const mockOnAddRound = vi.fn();
    const mockOnRegenerateRound = vi.fn();
    const mockOnDeleteRound = vi.fn();
    const mockOnDeleteHeat = vi.fn();
    const mockOnRunHeat = vi.fn();
    const mockOnReorderHeats = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        dragEndHandlers.length = 0;
        window.confirm = vi.fn(() => true);
    });

    it('renders the add round button', () => {
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={[]}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );
        expect(screen.getByText('Add Round')).toBeInTheDocument();
    });

    it('displays heats grouped by round', () => {
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={mockHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );
        expect(screen.getByText(/1 Round/i)).toBeInTheDocument();
        expect(screen.getByText('Heat 1')).toBeInTheDocument();
        expect(screen.getByText('Heat 2')).toBeInTheDocument();
    });

    it('opens modal when add round button is clicked', () => {
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={[]}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );
        fireEvent.click(screen.getByText('Add Round'));
        // Modal should open - check for modal content (Round Name input is a good proxy)
        expect(screen.getByLabelText(/Round Name/i)).toBeInTheDocument();
    });

    it('calls onRunHeat when run button is clicked', () => {
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={mockHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );
        const runButtons = screen.getAllByText('Run');
        fireEvent.click(runButtons[0]);
        expect(mockOnRunHeat).toHaveBeenCalled();
    });

    it('renders heats in a table', () => {
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={mockHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        // Verify table and rows are rendered
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(3); // 1 header + 2 heats
    });

    it('displays heats sorted by heat_number', () => {
        const unsortedHeats: Heat[] = [
            { id: 3, roundNumber: 1, roundId: 1, heatNumber: 3, lanes: [], roundName: 'Round 1' },
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
            { id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, lanes: [], roundName: 'Round 1' },
        ];

        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={unsortedHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        const heatElements = screen.getAllByText(/Heat \d/);
        expect(heatElements[0]).toHaveTextContent('Heat 1');
        expect(heatElements[1]).toHaveTextContent('Heat 2');
        expect(heatElements[2]).toHaveTextContent('Heat 3');
    });

    it('groups heats by round correctly', () => {
        const multiRoundHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
            { id: 3, roundNumber: 2, roundId: 2, heatNumber: 1, lanes: [], roundName: 'Round 2' },
        ];

        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={multiRoundHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        expect(screen.getByText('Round 1')).toBeInTheDocument();
        expect(screen.getByText('Round 2')).toBeInTheDocument();
    });

    it('calls onAddRound with name when provided', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={[]}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
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
            { id: 1, roundNumber: 1, roundName: 'Semi-Finals', roundId: 1, heatNumber: 1, lanes: [] },
        ];

        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={namedRoundHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        expect(screen.getByText('Semi-Finals')).toBeInTheDocument();
        expect(screen.queryByText('Round 1')).not.toBeInTheDocument();
    });

    it('keeps add round enabled and working when a championship round is named "Grand Finals" (#327)', async () => {
        // A round's name must never disable Add Round — chaining another
        // championship round off a final, or adding a Slowest Race bracket
        // after it, are both intended workflows (#327). "Grand Finals" is the
        // wizard's own default name for a championship round, so this is the
        // fixture the regression is actually about — not an arbitrary string
        // containing the word "Final". Asserting non-disabled alone would
        // still pass for a heats=[] fixture with nothing named "Final"
        // anywhere; clicking through to the dialog is the part that would
        // fail if a name-keyed disable came back.
        const user = (await import('@testing-library/user-event')).default.setup();
        const finalHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Grand Finals' },
        ];
        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={finalHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );
        const addBtn = screen.getByRole('button', { name: /Add Round/i });
        expect(addBtn).not.toBeDisabled();

        await user.click(addBtn);
        expect(screen.getByLabelText(/Round Name/i)).toBeInTheDocument();
    });

    it('calls onDeleteRound when delete button is clicked', async () => {
        const user = (await import('@testing-library/user-event')).default.setup();
        const roundHeats: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
        ];

        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={roundHeats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        const deleteBtn = screen.getByLabelText(/delete round 1/i);
        await user.click(deleteBtn);

        expect(mockOnDeleteRound).toHaveBeenCalledWith(1);
    });

    it('disables delete button if round has results', () => {
        const heatsWithResults: Heat[] = [
            { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [lane({ lane: 1, racerId: 1, time: 3.45 })], roundName: 'Round 1' },
        ];

        render(
            <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={heatsWithResults}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={mockOnAddRound}
                    onRegenerateRound={mockOnRegenerateRound}
                    onDeleteRound={mockOnDeleteRound}
                    onDeleteHeat={mockOnDeleteHeat}
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
            </MemoryRouter>
        );

        const deleteBtn = screen.getByLabelText(/delete round 1/i);
        expect(deleteBtn).toBeDisabled();
        expect(deleteBtn).toHaveAttribute('title', 'Cannot delete round: it has heats with results');
  });

  it('disables delete button for general round if championship round exists', () => {
    const multiRoundHeats: Heat[] = [
      { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'General' },
      { id: 2, roundNumber: 2, roundId: 2, heatNumber: 1, lanes: [], roundName: 'Finals' },
    ];

    render(
      <MemoryRouter>
      <AlertProvider>
        <ScheduleManagement
          raceId={1}
          heats={multiRoundHeats}
          generating={false}
          activeHeatId={null}
          onAddRound={mockOnAddRound}
          onRegenerateRound={mockOnRegenerateRound}
          onDeleteRound={mockOnDeleteRound}
          onDeleteHeat={mockOnDeleteHeat}
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
      </MemoryRouter>
    );

    const deleteBtn = screen.getByLabelText(/delete general/i);
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('title', 'Cannot delete general round: championship rounds are already scheduled');
  });

  it('disables run button when heat has placeholders', () => {
    const heatsWithPlaceholders: Heat[] = [
      { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [lane({ lane: 1, placeholderSlot: 1 })], roundName: 'Round 1' },
    ];

    render(
      <MemoryRouter>
      <AlertProvider>
        <ScheduleManagement
          raceId={1}
          heats={heatsWithPlaceholders}
          generating={false}
          activeHeatId={null}
          onAddRound={mockOnAddRound}
          onRegenerateRound={mockOnRegenerateRound}
          onDeleteRound={mockOnDeleteRound}
          onDeleteHeat={mockOnDeleteHeat}
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
      </MemoryRouter>
    );

    const runButton = screen.getByText('Run');
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAttribute('title', 'Racers not yet determined for this round');
  });

  it('disables run button for upcoming rounds', () => {
    const multiRoundHeats: Heat[] = [
      { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
      { id: 2, roundNumber: 2, roundId: 2, heatNumber: 1, lanes: [], roundName: 'Round 2' },
    ];

    render(
      <MemoryRouter>
      <AlertProvider>
        <ScheduleManagement
          raceId={1}
          heats={multiRoundHeats}
          generating={false}
          activeHeatId={null}
          onAddRound={mockOnAddRound}
          onRegenerateRound={mockOnRegenerateRound}
          onDeleteRound={mockOnDeleteRound}
          onDeleteHeat={mockOnDeleteHeat}
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
      </MemoryRouter>
    );

    // Round 1 Run button should be enabled
    const runButtons = screen.getAllByText('Run');
    expect(runButtons[0]).not.toBeDisabled();

    // Round 2 Run button should be disabled as Round 1 is not complete
    expect(runButtons[1]).toBeDisabled();
    expect(runButtons[1]).toHaveAttribute('title', 'Complete previous rounds first');
  });

  it('does not block a later round when an earlier heat was skipped (#333)', () => {
    const skippedHeatFollowedByRound2: Heat[] = [
      {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        roundName: 'Round 1',
        lanes: [lane({ lane: 1, skipped: true }), lane({ lane: 2, skipped: true })],
      },
      { id: 2, roundNumber: 2, roundId: 2, heatNumber: 1, lanes: [], roundName: 'Round 2' },
    ];

    render(
      <MemoryRouter>
      <AlertProvider>
        <ScheduleManagement
          raceId={1}
          heats={skippedHeatFollowedByRound2}
          generating={false}
          activeHeatId={null}
          onAddRound={mockOnAddRound}
          onRegenerateRound={mockOnRegenerateRound}
          onDeleteRound={mockOnDeleteRound}
          onDeleteHeat={mockOnDeleteHeat}
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
      </MemoryRouter>
    );

    // A skipped heat is finished, not stuck "uncompleted" forever — so Round
    // 2's Run button must not be disabled behind an instruction ("complete
    // previous rounds") the operator can never satisfy.
    const runButtons = screen.getAllByText('Run');
    expect(runButtons[0]).not.toBeDisabled();
    expect(runButtons[1]).not.toBeDisabled();
  });

  it('marks a round whose raced field has gone stale (#229)', () => {
    render(
      <MemoryRouter>
        <AlertProvider>
          <ScheduleManagement
            raceId={1}
            heats={[
              {
                id: 1,
                roundNumber: 2,
                roundId: 7,
                heatNumber: 1,
                roundName: 'Finals',
                lanes: [lane({ lane: 1, racerId: 1, time: 3.1, place: 1 })],
              },
            ]}
            generating={false}
            activeHeatId={null}
            onAddRound={vi.fn()}
            onRegenerateRound={vi.fn()}
            onDeleteRound={vi.fn()}
            onDeleteHeat={vi.fn()}
            onRunHeat={vi.fn()}
            onReorderHeats={vi.fn()}
            getRacerName={(id) => `Racer ${id}`}
            onRefetchHeats={vi.fn()}
            laneCount={4}
            racerCount={10}
            denCount={3}
            championshipTrophies={3}
            staleRoundIds={new Set([7])}
          />
        </AlertProvider>
      </MemoryRouter>
    );
    expect(screen.getByTestId('stale-field-badge-7')).toHaveTextContent('Line-up out of date');
  });

  it('shows no staleness badge without the flag', () => {
    render(
      <MemoryRouter>
        <AlertProvider>
          <ScheduleManagement
            raceId={1}
            heats={[
              { id: 1, roundNumber: 2, roundId: 7, heatNumber: 1, roundName: 'Finals', lanes: [] },
            ]}
            generating={false}
            activeHeatId={null}
            onAddRound={vi.fn()}
            onRegenerateRound={vi.fn()}
            onDeleteRound={vi.fn()}
            onDeleteHeat={vi.fn()}
            onRunHeat={vi.fn()}
            onReorderHeats={vi.fn()}
            getRacerName={(id) => `Racer ${id}`}
            onRefetchHeats={vi.fn()}
            laneCount={4}
            racerCount={10}
            denCount={3}
            championshipTrophies={3}
          />
        </AlertProvider>
      </MemoryRouter>
    );
    expect(screen.queryByTestId('stale-field-badge-7')).not.toBeInTheDocument();
  });

  describe('reordering (drag end)', () => {
    const threeHeats: Heat[] = [
      { id: 1, roundNumber: 1, roundId: 1, heatNumber: 1, lanes: [], roundName: 'Round 1' },
      { id: 2, roundNumber: 1, roundId: 1, heatNumber: 2, lanes: [], roundName: 'Round 1' },
      { id: 3, roundNumber: 1, roundId: 1, heatNumber: 3, lanes: [], roundName: 'Round 1' },
    ];

    const renderThreeHeats = () =>
      render(
        <MemoryRouter>
          <AlertProvider>
            <ScheduleManagement
              raceId={1}
              heats={threeHeats}
              generating={false}
              activeHeatId={null}
              onAddRound={mockOnAddRound}
              onRegenerateRound={mockOnRegenerateRound}
              onDeleteRound={mockOnDeleteRound}
              onDeleteHeat={mockOnDeleteHeat}
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
        </MemoryRouter>
      );

    it('reports the reordered heat numbers when a heat is dragged past its neighbors', async () => {
      renderThreeHeats();
      expect(dragEndHandlers).toHaveLength(1);

      // Drag heat 1 (index 0) to where heat 3 (index 2) sits.
      await act(async () => {
        await dragEndHandlers[0]({
          active: { id: 1 },
          over: { id: 3 },
        } as DragEndEvent);
      });

      expect(mockOnReorderHeats).toHaveBeenCalledWith([
        { heat_id: 2, new_heat_number: 1 },
        { heat_id: 3, new_heat_number: 2 },
        { heat_id: 1, new_heat_number: 3 },
      ]);
    });

    it('does nothing when a heat is dropped on itself', async () => {
      renderThreeHeats();

      await act(async () => {
        await dragEndHandlers[0]({
          active: { id: 2 },
          over: { id: 2 },
        } as DragEndEvent);
      });

      expect(mockOnReorderHeats).not.toHaveBeenCalled();
    });

    it('reverts the optimistic order and alerts when the reorder mutation fails', async () => {
      mockOnReorderHeats.mockRejectedValueOnce(new Error('network down'));
      renderThreeHeats();

      await act(async () => {
        await dragEndHandlers[0]({
          active: { id: 1 },
          over: { id: 3 },
        } as DragEndEvent);
      });

      expect(mockOnReorderHeats).toHaveBeenCalledTimes(1);
      // Reverted to the original order rather than left on the optimistic one.
      const heatCells = screen.getAllByText(/Heat \d/);
      expect(heatCells[0]).toHaveTextContent('Heat 1');
      expect(heatCells[1]).toHaveTextContent('Heat 2');
      expect(heatCells[2]).toHaveTextContent('Heat 3');
    });
  });
});
