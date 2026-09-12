import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScheduleManagement, Heat } from './ScheduleManagement';
import { AlertProvider } from '../../../context/AlertContext';
import { MemoryRouter } from 'react-router-dom';

/**
 * #892: the exact reproduction from the issue — a check-in tablet's Race
 * Control screen rendered Add Round, Delete, Regenerate and Re-Run fully
 * enabled, and pressing Re-Run gave "CHECKIN is not allowed to run
 * updateHeatResult". `isOperator` is a prop here (see the comment at the
 * top of `ScheduleManagement.test.tsx` on why this component does not call
 * `useRole()` itself), resolved once by `RaceControl.tsx`.
 */
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useMutation: vi.fn(() => [{ fetching: false }, vi.fn()]),
    };
});

vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: any) => <>{children}</>,
    closestCenter: vi.fn(),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
    arrayMove: vi.fn(),
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
    CSS: { Transform: { toString: () => '' } },
}));

const mockHeats: Heat[] = [
    {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        recordedAt: '2026-01-01T00:00:00Z',
        lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: 5.0, place: 1, skipped: false }],
        roundName: 'Round 1',
    },
];

// A round with no recorded times, so `isAnyStarted` is false and Delete's
// own disabled state reflects only `operatorDisabled` (#997) rather than
// also being disabled by "has heats with results".
const unracedHeats: Heat[] = [
    {
        id: 1,
        roundNumber: 1,
        roundId: 1,
        heatNumber: 1,
        recordedAt: null,
        lanes: [{ lane: 1, racerId: 1, placeholderSlot: null, time: null, place: null, skipped: false }],
        roundName: 'Round 1',
    },
];

function renderSchedule(isOperator: boolean | undefined, heats: Heat[] = mockHeats) {
    return render(
        <MemoryRouter>
            <AlertProvider>
                <ScheduleManagement
                    raceId={1}
                    heats={heats}
                    generating={false}
                    activeHeatId={null}
                    onAddRound={vi.fn()}
                    onRegenerateRound={vi.fn()}
                    onDeleteRound={vi.fn()}
                    onDeleteHeat={vi.fn()}
                    onRunHeat={vi.fn()}
                    onReorderHeats={vi.fn()}
                    getRacerName={vi.fn((id) => `Racer ${id}`)}
                    onRefetchHeats={vi.fn()}
                    laneCount={4}
                    racerCount={10}
                    racingGroupCount={1}
                    championshipTrophies={3}
                    isOperator={isOperator}
                />
            </AlertProvider>
        </MemoryRouter>,
    );
}

describe('ScheduleManagement reflects the caller role (#892)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('disables Add Round and Re-Run for a non-operator', () => {
        renderSchedule(false);

        expect(screen.getByRole('button', { name: /Add Round/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Re-Run' })).toBeDisabled();
    });

    it('names the operator PIN on the disabled controls', () => {
        renderSchedule(false);

        expect(screen.getByRole('button', { name: /Add Round/ })).toHaveAttribute(
            'title',
            'That needs the operator PIN. Enter it with the lock icon in the top bar.',
        );
    });

    it('leaves Add Round and Re-Run enabled when isOperator is omitted', () => {
        // The default: every existing caller of this component, and any
        // install with no PIN set, must render exactly as it always has.
        renderSchedule(undefined);

        expect(screen.getByRole('button', { name: /Add Round/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Re-Run' })).toBeEnabled();
    });

    it('disables a round\'s Delete for a non-operator, marked with the class the disabled rule reaches (#997)', () => {
        renderSchedule(false, unracedHeats);

        const deleteBtn = screen.getByRole('button', { name: /Delete Round 1/ });
        expect(deleteBtn).toBeDisabled();
        expect(deleteBtn).toHaveClass('secondary-btn');
    });

    it('leaves them enabled for an explicit operator', () => {
        renderSchedule(true);

        expect(screen.getByRole('button', { name: /Add Round/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Re-Run' })).toBeEnabled();
    });
});
