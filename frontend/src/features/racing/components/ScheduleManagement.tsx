import React, { useState } from 'react';
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
import { heatsEstimate } from '../../../utils/duration';
import type { Heat, Lane } from '../types';
import { hasRun, hasTimes } from '../lanes';

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
    runsPerLane?: number;
    generalType?: string;
  }) => Promise<void>;
  onRegenerateRound: (roundId: number, silent?: boolean) => Promise<void>;
  onDeleteRound: (roundId: number) => Promise<void>;
  onDeleteHeat: (heatId: number) => Promise<void>;
  onRefetchHeats: () => Promise<void>;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  onReorderHeats: (updates: { heat_id: number, new_heat_number: number }[]) => Promise<void>;
  getRacerName: (id: number) => string;
  laneCount: number;
  racerCount: number;
  denCount: number;
  championshipTrophies: number;
}



interface SortableHeatRowProps {
  heat: Heat;
  isRunning: boolean;
  isReordering: boolean;
  isUpcoming: boolean;
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

  // Disable dragging if heat is running, reordering is in progress, or heat has results
  const isDraggingDisabled = isRunning || isReordering || hasRecordedTimes;

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
    background: isDragging ? '#f5f5f5' : 'white',
    borderLeft: isRunning ? '5px solid orange' : (isSkipped && !hasRecordedTimes) ? '5px solid #f44336' : isCompleted ? '5px solid green' : '5px solid transparent',
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
        title={hasRecordedTimes ? "Cannot reorder completed heats" : isRunning ? "Cannot reorder running heat" : "Drag to reorder"}
      >
        <Icon path={mdiDragVertical} size={0.8} color="#999" />
      </td>
      <td style={{ padding: '12px', fontWeight: 'bold', width: '80px' }}>
        Heat {heat.globalHeatNumber ?? heat.heatNumber}
        {isSkipped && !hasRecordedTimes && (
          <div style={{ color: '#c62828', fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Skipped</div>
        )}
      </td>
      {Array.from({ length: laneCount }).map((_, i) => {
        const laneNum = i + 1;
        const result = lanes.find((l) => l.lane === laneNum);
        return (
          <td key={laneNum} style={{ padding: '8px 12px', borderLeft: '1px solid #f0f0f0' }}>
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
              <span style={{ color: '#ccc' }}>-</span>
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
                color: '#d32f2f',
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
  getRacerName,
  laneCount,
  racerCount,
  denCount,
  championshipTrophies,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
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

  const firstUncompletedRoundId = sortedRoundIds.find(roundId =>
    rounds[roundId].some(heat => !hasTimes(heat.lanes))
  ) || (sortedRoundIds.length > 0 ? sortedRoundIds[sortedRoundIds.length - 1] : 0);

  const hasGeneralRound = Object.values(rounds).some(roundHeats => {
      // In GraphQL we might need a better way to identify general rounds
      // but if roundNumber is small or name is 'All Pack'
      return roundHeats[0]?.roundName === 'All Pack' || roundHeats[0]?.roundNumber === 1;
  });

  const handleAddRound = async (config: {
    schedulingStrategy?: string;
    name: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    runsPerLane?: number;
    generalType?: string;
  }) => {
    await onAddRound(config);
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
      const e = error as { message?: string };
      showToast(e.message || 'Failed to reorder heats', 'error');
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
              <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#333' }}>
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
                disabled={generating || reordering || sortedRoundIds.some(r => (rounds[r][0]?.roundName || '').toLowerCase().includes('final'))}
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

        <RoundWizard
          key={String(isWizardOpen)}
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          raceId={raceId}
          racerCount={racerCount}
          denCount={denCount}
          laneCount={laneCount}
          championshipTrophies={championshipTrophies}
          onCreated={async () => {
              await onRefetchHeats();
          }}
        />

        <RoundConfigModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleAddRound}
          racerCount={racerCount}
          denCount={denCount}
          championshipTrophies={championshipTrophies}
          hasGeneralRound={hasGeneralRound}
        />

        {sortedRoundIds.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 40px',
            background: '#f9f9f9',
            borderRadius: '8px',
            border: '2px dashed #ddd',
            color: '#666'
          }}>
            <p style={{ fontSize: '1.1rem', margin: '0 0 10px 0' }}>No rounds yet</p>
            <p style={{ fontSize: '0.9rem', margin: '0 0 20px 0' }}>Creating your race schedule is easy. Use the wizard to generate all rounds in seconds.</p>
            <button
                className="primary-btn"
                onClick={() => setIsWizardOpen(true)}
                style={{ background: '#4caf50', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px' }}
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
                  background: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  border: '1px solid #eee'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    width: '100%',
                    gap: '20px',
                    borderBottom: '2px solid #f0f0f0',
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
                      <span style={{ fontSize: '0.9rem', color: '#666', fontWeight: 500 }}>
                        {uncompletedHeats === 0 ? (
                          <span style={{ color: '#2e7d32' }}>Completed</span>
                        ) : (
                          <>
                            {uncompletedHeats < totalHeats ? `${heatsEstimate(uncompletedHeats)} remaining` : `${heatsEstimate(totalHeats)} duration`}
                          </>
                        )}
                      </span>
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
                            color: '#d32f2f',
                            background: '#fff0f0'
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
                          <tr style={{ background: '#f8f9fa' }}>
                            <th style={{ padding: '12px 8px', width: '40px' }}></th>
                            <th style={{ padding: '12px', width: '100px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Heat</th>
                            {Array.from({ length: laneCount }).map((_, i) => (
                              <th key={i} style={{ padding: '12px', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Lane {i + 1}</th>
                            ))}
                            <th style={{ padding: '12px', width: '120px', textAlign: 'right', fontWeight: 'bold', color: '#666', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Actions</th>
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
                                isUpcoming={roundId > firstUncompletedRoundId}
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
