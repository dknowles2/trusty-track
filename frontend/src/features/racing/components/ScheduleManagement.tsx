import React, { useMemo, useState } from 'react';
import { RoundConfigModal } from './RoundConfigModal';
import { RoundWizard } from './RoundWizard';
import { Icon } from '@mdi/react';
import { mdiCached, mdiPlus, mdiDragVertical, mdiAutoFix, mdiDelete, mdiPrinter } from '@mdi/js';
import { Link } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAlert } from '../../../context/AlertContext';
import { useTerminology } from '../../../context/TerminologyContext';
import { errorText } from '../../../utils/errors';
import { heatsEstimate } from '../../../utils/duration';
import { ESTIMATED_HEAT_DURATION_MIN } from '../../../utils/constants';
import { estimatePace } from '../pace';
import type { Heat, Lane } from '../types';
import { hasRun, hasTimes } from '../lanes';
import { executionComparator } from '../runningOrder';

// Re-exported rather than redeclared: this used to be a hand-written copy that
// nothing tied to the schema, and it drifted the moment `lanes` was added.
export type { Heat };

interface ScheduleManagementProps {
  raceId: number;
  heats: Heat[];
  generating: boolean;
  activeHeatId: number | null;
  onAddRound: (config: {
    schedulingStrategy?: string;
    name: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    advancementFromBottom?: boolean;
    eliminationLosses?: number;
    balancedPhases?: number;
    runsPerLane?: number;
    generalType?: string;
  }) => Promise<void>;
  onRegenerateRound: (roundId: number, silent?: boolean) => Promise<void>;
  onDeleteRound: (roundId: number) => Promise<void>;
  onDeleteHeat: (heatId: number) => Promise<void>;
  onRefetchHeats: () => Promise<void>;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  onReorderHeats: (updates: { heat_id: number, new_heat_number: number }[]) => Promise<void>;
  /**
   * One interleaved running order across racing groups, rather than a block
   * per group (#549 stage 4) — the race's own setting, from `RaceForm`. Off
   * for every race until an operator opts in, which is what keeps this
   * screen showing exactly what it always has for every existing race.
   *
   * With it on, rounds progress concurrently, so the "complete previous
   * rounds first" Run gating is off — a later round's heat is runnable the
   * moment its turn comes up — and within-round dragging is off too, because
   * `reorderHeats` renumbers a round 1..N, which would yank its heats to the
   * head of the interleave.
   */
  masterRunningOrder?: boolean;
  /**
   * A round's own racing group, by round id — what labels a heat below with
   * the group whose cars are on the track. Absent for a round scoped to no
   * single group (a combined general round, a championship round drawing
   * from several), which is an ordinary state, not a missing one.
   */
  roundGroupLabel?: Record<number, string>;
  /**
   * Interleaves the race's current *pending* heats into one running order
   * (`applyMasterRunningOrder`). A deliberate, re-runnable operator action —
   * it recomputes the whole order from scratch, which is right for this
   * click and wrong for the automatic mid-event repair a lane outage or a
   * latecomer triggers on their own seam.
   */
  onApplyMasterRunningOrder?: () => Promise<void>;
  getRacerName: (id: number) => string;
  laneCount: number;
  racerCount: number;
  racingGroupCount: number;
  championshipTrophies: number;
  lastChampionshipRound?: { id: number; name: string | null } | null;
  /**
   * Rounds whose raced field no longer matches who would advance from the
   * standings as they now are (#229). A correction to an earlier time after a
   * final has been raced deliberately does not rewrite the final — this is
   * how the operator finds out it happened.
   */
  staleRoundIds?: ReadonlySet<number>;
  /**
   * Rounds whose last qualifying slot is a tie the tiebreak chain did not
   * settle (#540) — `fieldIsStale`'s pattern, for a different silence. The
   * pick shown for that slot is still provisional: the round stays runnable
   * (#48), and this is only the seeing half.
   */
  contestedRoundIds?: ReadonlySet<number>;
  /**
   * Rounds with an `advancementSource` — exempt from the interleave and
   * placed last in the master-order panel, the same rule the execution flow
   * sorts by (`runningOrder.ts`).
   */
  championshipRoundIds?: ReadonlySet<number>;
}



interface SortableHeatRowProps {
  heat: Heat;
  isRunning: boolean;
  isReordering: boolean;
  isUpcoming: boolean;
  masterRunningOrder: boolean;
  getRacerName: (id: number) => string;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  onDeleteHeat: (heatId: number) => Promise<void>;
  laneCount: number;
}

const getDisplayName = (lane: Lane, getRacerName: (id: number) => string) => {
  if (lane.placeholderSlot !== null) return `Placeholder ${lane.placeholderSlot}`;
  if (lane.racerId === null) return "Empty";
  return getRacerName(lane.racerId);
};

const SortableHeatRow: React.FC<SortableHeatRowProps> = ({
  heat,
  isRunning,
  isReordering,
  isUpcoming,
  masterRunningOrder,
  getRacerName,
  onRunHeat,
  onDeleteHeat,
  laneCount
}) => {
  const lanes = heat.lanes;
  const hasRecordedTimes = hasTimes(lanes);
  const isSkipped = lanes.some((l) => l.skipped);
  const isCompleted = hasRun(lanes);
  const hasPlaceholders = lanes.some((l) => l.placeholderSlot !== null);

  // Disable dragging if heat is running, reordering is in progress, or heat
  // has results — or the race runs a master running order, where a drag's
  // 1..N renumbering would silently pull this round out of the interleave.
  const isDraggingDisabled = isRunning || isReordering || hasRecordedTimes || masterRunningOrder;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: heat.id,
    disabled: isDraggingDisabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? 'var(--background-color)' : 'var(--surface-color)',
    borderLeft: isRunning ? '5px solid orange' : (isSkipped && !hasRecordedTimes) ? '5px solid var(--danger-accent-color)' : isCompleted ? '5px solid green' : '5px solid transparent',
  };

  const isRunDisabled = isRunning || hasPlaceholders || isUpcoming;
  const runBtnTitle = hasPlaceholders
    ? "Racers not yet determined for this round"
    : isUpcoming
      ? "Complete previous rounds first"
      : "";

  return (
    <tr ref={setNodeRef} style={style}>
      <td
        {...attributes}
        {...listeners}
        style={{
          cursor: isDraggingDisabled ? 'not-allowed' : 'grab',
          padding: '12px 8px',
          textAlign: 'center',
          width: '40px',
          opacity: isDraggingDisabled ? 0.4 : 1,
        }}
        title={masterRunningOrder ? "Heats follow the master running order" : hasRecordedTimes ? "Cannot reorder completed heats" : isRunning ? "Cannot reorder running heat" : "Drag to reorder"}
      >
        <Icon path={mdiDragVertical} size={0.8} color="var(--text-faint-color)" />
      </td>
      <td style={{ padding: '12px', fontWeight: 'bold', width: '80px' }}>
        Heat {heat.globalHeatNumber ?? heat.heatNumber}
        {isSkipped && !hasRecordedTimes && (
          <div style={{ color: 'var(--danger-strong-color)', fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Skipped</div>
        )}
      </td>
      {Array.from({ length: laneCount }).map((_, i) => {
        const laneNum = i + 1;
        const result = lanes.find((l) => l.lane === laneNum);
        return (
          <td key={laneNum} style={{ padding: '8px 12px', borderLeft: '1px solid var(--surface-soft-color)' }}>
            {result ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{getDisplayName(result, getRacerName)}</span>
                {result.time != null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--scouting-blue)', fontFamily: 'monospace' }}>
                    {Number(result.time).toFixed(4)}s
                  </span>
                )}
              </div>
            ) : (
              <span style={{ color: 'var(--input-border-color)' }}>-</span>
            )}
          </td>
        );
      })}
      <td style={{ padding: '12px', textAlign: 'right', width: '120px' }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {!isCompleted && !isRunning && (
            <button
              onClick={() => onDeleteHeat(heat.id)}
              className="icon-btn-delete"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--error)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                opacity: 0.7
              }}
              title="Delete Heat"
            >
              <Icon path={mdiDelete} size={0.7} />
            </button>
          )}
          <button
            className="primary-btn"
            onClick={() => onRunHeat(heat, !isCompleted)}
            disabled={isRunDisabled}
            title={runBtnTitle}
            style={{ padding: '4px 12px', fontSize: '0.8rem', minWidth: '70px' }}
          >
            {isRunning ? '...' : (isSkipped && !hasRecordedTimes) ? 'Run' : isCompleted ? 'Re-Run' : 'Run'}
          </button>
        </div>
      </td>
    </tr>
  );
};

export const ScheduleManagement: React.FC<ScheduleManagementProps> = ({
  raceId,
  heats,
  generating,
  activeHeatId,
  onAddRound,
  onRegenerateRound,
  onDeleteRound,
  onDeleteHeat,
  onRefetchHeats,
  onRunHeat,
  onReorderHeats,
  masterRunningOrder = false,
  roundGroupLabel = {},
  onApplyMasterRunningOrder,
  getRacerName,
  laneCount,
  racerCount,
  racingGroupCount,
  championshipTrophies,
  lastChampionshipRound,
  staleRoundIds,
  contestedRoundIds,
  championshipRoundIds,
}) => {
  const { group } = useTerminology();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [applyingOrder, setApplyingOrder] = useState(false);
  // A local copy of the heats, so a drag lands immediately rather than after
  // the round trip. It has to follow the real ones whenever they change.
  const [localHeats, setLocalHeats] = useState<Heat[]>(heats);
  const [syncedFrom, setSyncedFrom] = useState(heats);
  const { showToast } = useAlert();

  // Adjusted during render rather than in an effect. React re-runs this
  // component before touching the DOM, so the stale order never reaches the
  // screen — where an effect painted the old order first and corrected it on
  // the next frame.
  if (heats !== syncedFrom) {
    setSyncedFrom(heats);
    setLocalHeats(heats);
  }

  const rounds = localHeats.reduce((acc, heat) => {
    if (!acc[heat.roundId]) {
      acc[heat.roundId] = [];
    }
    acc[heat.roundId].push(heat);
    return acc;
  }, {} as Record<number, Heat[]>);

  // This race's learned turnaround pace (#591) — over every heat in the
  // race, not just the round being shown, since staging and reset time is a
  // property of how this event is run rather than of any one round.
  const pace = useMemo(
    () => estimatePace(heats.map((h) => h.recordedAt), ESTIMATED_HEAT_DURATION_MIN),
    [heats]
  );

  // Note: We'll eventually want to move advancement status to GraphQL too if possible
  // For now, we'll keep it as is or handle it via a manual fetch/prop

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get unique round IDs in order of their round numbers
  const sortedRoundIds = Object.keys(rounds)
    .map(Number)
    .sort((a, b) => (rounds[a][0]?.roundNumber || 0) - (rounds[b][0]?.roundNumber || 0));

  // A skipped heat is finished (`hasRun`, the frontend counterpart of the
  // backend's `is_finished` — "the operator is not coming back to it"), so
  // gating on `hasTimes` here left a round with one scratched heat
  // "uncompleted" forever and blocked every later round's Run button (#333).
  // Tracked by round *number*, not round id — ids happen to order the same
  // way today, but that is not guaranteed (#250).
  const firstUncompletedRoundId = sortedRoundIds.find(roundId =>
    rounds[roundId].some(heat => !hasRun(heat.lanes))
  ) || (sortedRoundIds.length > 0 ? sortedRoundIds[sortedRoundIds.length - 1] : 0);
  const firstUncompletedRoundNumber = rounds[firstUncompletedRoundId]?.[0]?.roundNumber || 0;

  const hasGeneralRound = Object.values(rounds).some(roundHeats => {
      // Round 1 is always the general round; its default name is now
      // derived from the race's own terminology (#533), so it is no longer
      // a fixed literal this check could compare against.
      return roundHeats[0]?.roundNumber === 1;
  });

  const handleAddRound = async (config: {
    schedulingStrategy?: string;
    name: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    advancementFromBottom?: boolean;
    eliminationLosses?: number;
    balancedPhases?: number;
    runsPerLane?: number;
    generalType?: string;
  }) => {
    await onAddRound(config);
  };

  // The whole race's heats in the running order — the same rule the Race tab
  // and the wall displays sort with (`runningOrder.ts`), so this panel cannot
  // disagree with the screen that runs the race. Championship rounds sit at
  // the end whatever numbers they hold, since they are exempt from the
  // interleave (their heats are renumbered 1..N by every advancement
  // rebuild). Shown only while the race has opted in; the per-round tables
  // below are unchanged either way, which is what keeps every existing
  // race's screen exactly as it was.
  const masterOrderHeats = [...localHeats].sort(
    executionComparator(true, championshipRoundIds ?? new Set()),
  );

  const handleApplyMasterRunningOrder = async () => {
    if (!onApplyMasterRunningOrder) return;
    setApplyingOrder(true);
    try {
      await onApplyMasterRunningOrder();
      showToast('Master running order applied', 'success');
    } catch (error: unknown) {
      console.error('Failed to apply master running order:', error);
      showToast(errorText(error, 'The master running order could not be applied.'), 'error');
    } finally {
      setApplyingOrder(false);
    }
  };

  const handleDragOver = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // We don't strictly need to update state in handleDragOver for single-list sorting
    // as SortableContext handles the visual part. But if we wanted to, we would
    // just swap IDs in a list. Since we're using heatNumber for sorting,
    // let's try to only update on drag end to keep it stable.
  };

  const handleDragEnd = async (event: DragEndEvent, roundId: number) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const roundHeats = [...(rounds[roundId] || [])].sort((a, b) => a.heatNumber - b.heatNumber);
    const oldIndex = roundHeats.findIndex(h => h.id === active.id);
    const newIndex = roundHeats.findIndex(h => h.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reorderedHeats = arrayMove(roundHeats, oldIndex, newIndex);
    const newHeatUpdates = reorderedHeats.map((heat, index) => ({
      heat_id: heat.id,
      new_heat_number: index + 1,
    }));

    // Optimistically update local state
    const updatedRoundHeats = reorderedHeats.map((heat, index) => ({
        ...heat,
        heatNumber: index + 1,
    }));

    const optimisticHeats = localHeats.map(h => {
        if (h.roundId === roundId) {
            return updatedRoundHeats.find(u => u.id === h.id) || h;
        }
        return h;
    }).sort((a, b) => {
        if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
        return a.heatNumber - b.heatNumber;
    }).map((h, idx) => ({ ...h, globalHeatNumber: idx + 1 }));

    setLocalHeats(optimisticHeats);

    // Prepare original order for undo
    const originalHeatUpdates = roundHeats.map((heat, index) => ({
      heat_id: heat.id,
      new_heat_number: index + 1,
    }));

    setReordering(true);
    try {
      await onReorderHeats(newHeatUpdates);

      showToast('Heat order updated', 'success', {
        label: 'Undo',
        onClick: async () => {
          try {
            await onReorderHeats(originalHeatUpdates);
            showToast('Heat order restored', 'info');
          } catch (error) {
            console.error('Failed to undo reorder:', error);
            showToast('Failed to undo changes', 'error');
          }
        }
      });
    } catch (error: unknown) {
      console.error('Failed to reorder heats:', error);
      showToast(errorText(error, 'The heats could not be reordered.'), 'error');
      // Revert local state on error
      setLocalHeats(heats);
    } finally {
      setReordering(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: '1200px' }}>
        <div style={{ display: 'flex', justifyContent: sortedRoundIds.length > 0 ? 'space-between' : 'flex-end', alignItems: 'center', marginBottom: '20px', gap: '20px' }}>
          {sortedRoundIds.length > 0 && (
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-color)' }}>
                {sortedRoundIds.length} Round{sortedRoundIds.length > 1 ? 's' : ''} Scheduled
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* The running order on paper, for the announcer's table (#173).
                Here rather than on the roster's print page: that page prints
                the roster, and this prints the schedule. */}
            {sortedRoundIds.length > 0 && (
              <Link
                to={`/race/${raceId}/print/heat-sheet`}
                className="secondary-btn"
                data-testid="print-heat-sheet"
                style={{ whiteSpace: 'nowrap', gap: '5px' }}
              >
                <Icon path={mdiPrinter} size={0.8} /> Heat sheet
              </Link>
            )}
            <button
                className="primary-btn"
                onClick={() => setIsModalOpen(true)}
                disabled={generating || reordering}
                style={{
                  boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
            >
                <Icon path={mdiPlus} size={0.8} /> Add Round
            </button>
          </div>
        </div>

        {/* The master running order (#549 stage 4): one interleaved sequence
            across every racing group, shown here because the per-round
            tables below — grouped block by block — are otherwise unreadable
            once heat numbers jump between groups. Rendered only while the
            race has opted in, so an ordinary race's screen is unchanged. */}
        {masterRunningOrder && sortedRoundIds.length > 0 && (
          <div
            data-testid="master-running-order"
            style={{
              background: 'var(--surface-tint-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '30px',
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '12px',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-color)' }}>
                  Master running order
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted-color)' }}>
                  One sequence across every {group}, so the track need not sit empty between them.
                </p>
              </div>
              <button
                className="secondary-btn"
                onClick={handleApplyMasterRunningOrder}
                disabled={generating || reordering || applyingOrder || !onApplyMasterRunningOrder}
                data-testid="apply-master-running-order"
                style={{ whiteSpace: 'nowrap' }}
              >
                {applyingOrder ? 'Applying…' : 'Apply master order'}
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-muted-color)', textTransform: 'uppercase' }}>Heat</th>
                    <th style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-muted-color)', textTransform: 'uppercase' }}>Round</th>
                    <th style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-muted-color)', textTransform: 'uppercase' }}>{group}</th>
                    <th style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-muted-color)', textTransform: 'uppercase' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {masterOrderHeats.map(heat => (
                    <tr key={heat.id} style={{ borderTop: '1px solid var(--divider-color)' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 'bold' }}>Heat {heat.heatNumber}</td>
                      <td style={{ padding: '6px 12px' }}>{heat.roundName || `Round ${heat.roundNumber}`}</td>
                      <td style={{ padding: '6px 12px' }}>{roundGroupLabel[heat.roundId] ?? '—'}</td>
                      <td style={{ padding: '6px 12px', color: hasRun(heat.lanes) ? 'var(--success-color)' : 'var(--text-muted-color)' }}>
                        {hasRun(heat.lanes) ? 'Done' : 'Upcoming'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <RoundWizard
          key={String(isWizardOpen)}
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          raceId={raceId}
          racerCount={racerCount}
          racingGroupCount={racingGroupCount}
          laneCount={laneCount}
          championshipTrophies={championshipTrophies}
          minutesPerHeat={pace.minutesPerHeat}
          onCreated={async () => {
              await onRefetchHeats();
          }}
        />

        <RoundConfigModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleAddRound}
          racerCount={racerCount}
          racingGroupCount={racingGroupCount}
          laneCount={laneCount}
          championshipTrophies={championshipTrophies}
          hasGeneralRound={hasGeneralRound}
          lastChampionshipRound={lastChampionshipRound}
        />

        {sortedRoundIds.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 40px',
            background: 'var(--surface-tint-color)',
            borderRadius: '8px',
            border: '2px dashed var(--border-color)',
            color: 'var(--text-muted-color)'
          }}>
            <p style={{ fontSize: '1.1rem', margin: '0 0 10px 0' }}>No rounds yet</p>
            <p style={{ fontSize: '0.9rem', margin: '0 0 20px 0' }}>Creating your race schedule is easy. Use the wizard to generate all rounds in seconds.</p>
            <button
                className="primary-btn"
                onClick={() => setIsWizardOpen(true)}
                style={{ background: 'var(--success-accent-color)', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px' }}
            >
                <Icon path={mdiAutoFix} size={0.9} /> Start Round Creation Wizard
            </button>
            <div style={{ marginTop: '15px', fontSize: '0.8rem' }}>
                or <button onClick={() => setIsModalOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--scouting-blue)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>manually add a single round</button>
            </div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '40px',
            paddingBottom: '40px',
          }}>
            {sortedRoundIds.map(roundId => {
              const roundHeats = [...(rounds[roundId] || [])].sort((a, b) => a.heatNumber - b.heatNumber);
              const roundNum = roundHeats[0]?.roundNumber || 0;
              const isAnyStarted = roundHeats.some(h => hasTimes(h.lanes));
              const uncompletedHeats = roundHeats.filter(h => !hasRun(h.lanes)).length;
              const totalHeats = roundHeats.length;

              return (
                <div key={roundId} style={{
                  background: 'var(--surface-color)',
                  borderRadius: '12px',
                  padding: '20px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  border: '1px solid var(--divider-color)'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    width: '100%',
                    gap: '20px',
                    borderBottom: '2px solid var(--surface-soft-color)',
                    paddingBottom: '15px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                      <h2 style={{
                        margin: 0,
                        color: 'var(--scouting-blue)',
                        textAlign: 'left',
                        fontSize: '1.5rem'
                      }}>
                        {roundHeats[0]?.roundName || `Round ${roundNum}`}
                      </h2>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-muted-color)', fontWeight: 500 }}>
                        {uncompletedHeats === 0 ? (
                          <span style={{ color: 'var(--success-color)' }}>Completed</span>
                        ) : (
                          <>
                            {uncompletedHeats < totalHeats
                              ? `${heatsEstimate(uncompletedHeats, pace.minutesPerHeat)} remaining`
                              : `${heatsEstimate(totalHeats, pace.minutesPerHeat)} duration`}
                          </>
                        )}
                      </span>
                      {staleRoundIds?.has(Number(roundId)) && (
                        <span
                          data-testid={`stale-field-badge-${roundId}`}
                          title="An earlier result was corrected after this round was raced, and its field no longer matches the standings. The results below stand — deciding whether to re-run it is your call."
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            color: 'var(--warning-soft-color)',
                            background: 'var(--warning-soft-bg-color)',
                            border: '1px solid var(--warning-soft-border-color)',
                            borderRadius: '10px',
                            padding: '2px 10px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Line-up out of date
                        </span>
                      )}
                      {contestedRoundIds?.has(Number(roundId)) && (
                        <span
                          data-testid={`contested-cut-badge-${roundId}`}
                          title="The last qualifying slot is a tie your tiebreaker setting could not settle. The pick below is provisional — settle it yourself, or change the tiebreaker in the race's settings."
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            color: 'var(--warning-soft-color)',
                            background: 'var(--warning-soft-bg-color)',
                            border: '1px solid var(--warning-soft-border-color)',
                            borderRadius: '10px',
                            padding: '2px 10px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Tie unresolved
                        </span>
                      )}
                      {contestedRoundIds?.has(Number(roundId)) && (
                        // The control that actually creates a run-off heat
                        // lives on the Standings page (#550), against the
                        // shared rank it settles — this is a one-click
                        // bridge from where the tie is *seen* to where it
                        // is *settled*, not a second copy of the control.
                        <Link
                          to={`/race/${raceId}/standings`}
                          data-testid={`contested-cut-run-off-link-${roundId}`}
                          style={{ fontSize: '0.8rem', color: 'var(--scouting-blue)' }}
                        >
                          Start a run-off →
                        </Link>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      {!isAnyStarted && (
                        <button
                          onClick={() => onRegenerateRound(roundId)}
                          className="secondary-btn"
                          disabled={generating || reordering}
                          aria-label={`Regenerate ${roundHeats[0]?.roundName || `Round ${roundNum}`}`}
                          style={{
                            padding: '6px 16px',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <Icon path={mdiCached} size={0.7} /> Regenerate
                        </button>
                      )}
                      {(
                        <button
                          onClick={() => onDeleteRound(roundId)}
                          className="secondary-btn"
                          disabled={generating || reordering || isAnyStarted || roundNum < Math.max(...sortedRoundIds.map(rid => rounds[rid][0]?.roundNumber || 0))}
                          aria-label={`Delete ${roundHeats[0]?.roundName || `Round ${roundNum}`}`}
                          title={
                              isAnyStarted
                                ? "Cannot delete round: it has heats with results"
                                : roundNum < Math.max(...sortedRoundIds.map(rid => rounds[rid][0]?.roundNumber || 0))
                                  ? "Cannot delete general round: championship rounds are already scheduled"
                                  : undefined
                          }
                          style={{
                            padding: '6px 16px',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: 'var(--error)',
                            background: 'var(--danger-tint-bg-color)'
                          }}
                        >
                          <Icon path={mdiDelete} size={0.7} /> Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragOver={handleDragOver}
                      onDragEnd={(event) => handleDragEnd(event, roundId)}
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface-alt-color)' }}>
                            <th style={{ padding: '12px 8px', width: '40px' }}></th>
                            <th style={{ padding: '12px', width: '100px', fontWeight: 'bold', color: 'var(--text-muted-color)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Heat</th>
                            {Array.from({ length: laneCount }).map((_, i) => (
                              <th key={i} style={{ padding: '12px', fontWeight: 'bold', color: 'var(--text-muted-color)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Lane {i + 1}</th>
                            ))}
                            <th style={{ padding: '12px', width: '120px', textAlign: 'right', fontWeight: 'bold', color: 'var(--text-muted-color)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Actions</th>
                          </tr>
                        </thead>
                        <SortableContext
                          items={roundHeats.map(h => h.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <tbody>
                            {roundHeats.map(heat => (
                              <SortableHeatRow
                                key={heat.id}
                                heat={heat}
                                isRunning={activeHeatId === heat.id}
                                isReordering={reordering}
                                // Under a master running order rounds progress
                                // concurrently, so no round is "upcoming" —
                                // the next group's heat must be runnable while
                                // this group's round is still open (#549).
                                isUpcoming={masterRunningOrder ? false : roundNum > firstUncompletedRoundNumber}
                                masterRunningOrder={masterRunningOrder}
                                getRacerName={getRacerName}
                                onRunHeat={onRunHeat}
                                onDeleteHeat={onDeleteHeat}
                                laneCount={laneCount}
                              />
                            ))}
                          </tbody>
                        </SortableContext>
                      </table>
                    </DndContext>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
