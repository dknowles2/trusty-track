import React, { useState } from 'react';
import { RoundConfigModal } from './RoundConfigModal';
import { RoundWizard } from './RoundWizard';
import Icon from '@mdi/react';
import { mdiCached, mdiPlus, mdiDragVertical, mdiAutoFix } from '@mdi/js';
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
import { apiClient } from '../../api/client';
import { useAlert } from '../../context/AlertContext';

interface Heat {
  id: number;
  round_number: number;
  round_name?: string;
  round_id: number;
  heat_number: number;
  lane_results: string; // JSON
}

interface ScheduleManagementProps {
  raceId: number;
  heats: Heat[];
  generating: boolean;
  activeHeatId: number | null;
  onAddRound: (schedulingStrategy: string, name?: string) => Promise<void>;
  onRegenerateRound: (roundNumber: number, silent?: boolean) => Promise<void>;
  onRefetchHeats: () => Promise<void>;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  getRacerName: (id: number) => string;
  laneCount: number;
  racerCount: number;
  denCount: number;
}

interface AdvancementRacer {
  racer_id: number;
  first_name: string;
  last_name: string;
  car_number?: number;
  den_name: string;
  score: number;
  rank: number;
}

interface AdvancementStatus {
  is_ready: boolean;
  requires_advancement: boolean;
  already_advanced: boolean;
  advancing_racers: AdvancementRacer[];
  source?: string;
  num_racers?: number;
}

interface SortableHeatCardProps {
  heat: Heat;
  isRunning: boolean;
  isReordering: boolean;
  getRacerName: (id: number) => string;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
}

const getDisplayName = (id: number, getRacerName: (id: number) => string) => {
  if (id === null) return "Empty";
  if (id < 0) return `Placeholder ${Math.abs(id)}`;
  return getRacerName(id);
};

const SortableHeatCard: React.FC<SortableHeatCardProps> = ({
  heat,
  isRunning,
  isReordering,
  getRacerName,
  onRunHeat,
}) => {
  const laneResults = heat.lane_results ? JSON.parse(heat.lane_results) : [];
  const hasResults = laneResults.length > 0 && laneResults.some((r: any) => r.time !== null);
  const isCompleted = hasResults;

  // Disable dragging if heat is running, reordering is in progress, or heat has results
  const isDraggingDisabled = isRunning || isReordering || hasResults;

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
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: '#fff',
        borderRadius: '8px',
        marginBottom: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: isDraggingDisabled ? 'not-allowed' : 'grab',
            padding: '10px 8px',
            background: isDraggingDisabled ? '#f5f5f5' : '#fafafa',
            borderRight: '1px solid #e0e0e0',
            display: 'flex',
            alignItems: 'center',
            opacity: isDraggingDisabled ? 0.4 : 1,
          }}
          title={hasResults ? "Cannot reorder completed heats" : isRunning ? "Cannot reorder running heat" : "Drag to reorder"}
        >
          <Icon path={mdiDragVertical} size={0.8} color="#999" />
        </div>

        {/* Heat Content */}
        <div style={{ flex: 1, padding: '15px', borderLeft: isRunning ? '5px solid orange' : isCompleted ? '5px solid green' : '5px solid #ccc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: 'bold' }}>Heat {heat.heat_number}</span>
            <button
              className="primary-btn"
              onClick={() => onRunHeat(heat, !isCompleted)}
              disabled={isRunning}
              style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: '60px' }}
            >
              {isRunning ? '...' : isCompleted ? 'Re-Run' : 'Run'}
            </button>
          </div>
          <div style={{ fontSize: '0.85rem' }}>
            {laneResults.map((r: any) => (
              <div key={r.lane} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: '80px' }}>
                  <span style={{ fontSize: '0.7rem', color: '#888', textTransform: 'uppercase', marginBottom: '2px' }}>Lane {r.lane}</span>
                  <span style={{ fontWeight: 500 }}>{getDisplayName(r.racer_id, getRacerName)}</span>
                </div>
                <span style={{ textAlign: 'right', minWidth: '50px', fontFamily: 'monospace' }}>
                  {r.time ? `${r.time}s` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ScheduleManagement: React.FC<ScheduleManagementProps> = ({
  raceId,
  heats,
  generating,
  activeHeatId,
  onAddRound,
  onRegenerateRound,
  onRefetchHeats,
  onRunHeat,
  getRacerName,
  laneCount,
  racerCount,
  denCount,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [advancementStatuses, setAdvancementStatuses] = useState<Record<number, AdvancementStatus>>({});
  const { showToast } = useAlert();
  const _raceId = raceId;

  const rounds = heats.reduce((acc, heat) => {
    if (!acc[heat.round_number]) {
      acc[heat.round_number] = [];
    }
    acc[heat.round_number].push(heat);
    return acc;
  }, {} as Record<number, Heat[]>);

  const fetchAdvancementStatus = async (roundId: number) => {
    try {
      const response = await apiClient.get<AdvancementStatus>(`/races/${_raceId}/rounds/${roundId}/advancement_status`);
      setAdvancementStatuses(prev => ({ ...prev, [roundId]: response }));
    } catch (error) {
      console.error('Failed to fetch advancement status:', error);
    }
  };

  React.useEffect(() => {
    // Determine which rounds need status (rounds with placeholders)
    Object.values(rounds).forEach(roundHeats => {
        const roundId = roundHeats[0]?.round_id;
        if (!roundId) return;
        
        const hasPlaceholders = roundHeats.some(h => {
            if (!h.lane_results) return false;
            const res = JSON.parse(h.lane_results);
            return res.some((r: any) => r.racer_id < 0);
        });

        if (hasPlaceholders && !advancementStatuses[roundId]) {
            fetchAdvancementStatus(roundId);
        }
    });
  }, [rounds, _raceId, advancementStatuses]); // Added dependencies for useEffect


  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const sortedRounds = Object.keys(rounds).map(Number).sort((a, b) => a - b);

  const handleAddRound = async (schedulingStrategy: string, name?: string) => {
    await onAddRound(schedulingStrategy, name);
  };

  const handleDragEnd = async (event: DragEndEvent, roundNum: number) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const roundHeats = rounds[roundNum].sort((a, b) => a.heat_number - b.heat_number);
    const oldIndex = roundHeats.findIndex(h => h.id === active.id);
    const newIndex = roundHeats.findIndex(h => h.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Store original order for undo
    const originalHeatUpdates = roundHeats.map((heat, index) => ({
      heat_id: heat.id,
      new_heat_number: index + 1,
    }));

    // Calculate new order
    const reorderedHeats = arrayMove(roundHeats, oldIndex, newIndex);
    const newHeatUpdates = reorderedHeats.map((heat, index) => ({
      heat_id: heat.id,
      new_heat_number: index + 1,
    }));

    // Optimistically update the UI by calling the parent's refetch
    setReordering(true);
    try {
      // Call API to persist the change
      await apiClient.put('/heats/reorder', { heat_updates: newHeatUpdates });
      
      // Refetch to update UI (just fetch, don't regenerate)
      await onRefetchHeats();
      
      // Show success toast with undo option
      showToast('Heat order updated', 'success', {
        label: 'Undo',
        onClick: async () => {
          try {
            await apiClient.put('/heats/reorder', { heat_updates: originalHeatUpdates });
            await onRefetchHeats();
            showToast('Heat order restored', 'info');
          } catch (error) {
            console.error('Failed to undo reorder:', error);
            showToast('Failed to undo changes', 'error');
          }
        }
      });
    } catch (error: any) {
      console.error('Failed to reorder heats:', error);
      showToast(error.message || 'Failed to reorder heats', 'error');
      // Revert UI by refetching
      await onRefetchHeats();
    } finally {
      setReordering(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 'fit-content' }}>
        {/* Actions Toolbar */}
        <div style={{ display: 'flex', justifyContent: sortedRounds.length > 0 ? 'space-between' : 'flex-end', alignItems: 'center', marginBottom: '15px', gap: '20px' }}>
          {sortedRounds.length > 0 && (
            <div style={{ textAlign: 'center', flex: 1, minWidth: '150px' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>
                {sortedRounds.length} Round{sortedRounds.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
                className="primary-btn"
                onClick={() => setIsModalOpen(true)}
                disabled={generating || reordering}
                style={{ boxShadow: '0 2px 5px rgba(0,0,0,0.1)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
                <Icon path={mdiPlus} size={0.8} /> Add Round
            </button>
          </div>
        </div>

        <RoundWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          raceId={_raceId}
          racerCount={racerCount}
          denCount={denCount}
          laneCount={laneCount}
          onCreated={async () => {
              await onRefetchHeats();
          }}
        />

        <RoundConfigModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleAddRound}
        />

        {sortedRounds.length === 0 ? (
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
            overflowX: 'auto',
            gap: '20px',
            paddingBottom: '20px',
            alignItems: 'flex-start',
            justifyContent: 'center'
          }}>
            {sortedRounds.map(roundNum => {
              const roundHeats = rounds[roundNum].sort((a, b) => a.heat_number - b.heat_number);
              const roundId = roundHeats[0]?.round_id;
              const isAnyStarted = roundHeats.some(h => {
                if (!h.lane_results) return false;
                const results = JSON.parse(h.lane_results);
                return results.some((r: any) => r.time !== null);
              });

              return (
                <div key={roundNum} style={{
                  minWidth: '350px',
                  background: '#f5f5f5',
                  borderRadius: '8px',
                  padding: '10px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0, color: 'var(--scouting-blue)' }}>
                      {roundHeats[0]?.round_name || `Round ${roundNum}`}
                    </h3>
                    {/* Only show regenerate for non-championship rounds (rounds without advancement status) */
                     !isAnyStarted && roundId && !advancementStatuses[roundId] && (
                      <button
                        onClick={() => onRegenerateRound(roundId)}
                        className="secondary-btn"
                        disabled={generating || reordering}
                        style={{
                          position: 'absolute', right: 0, padding: '2px 8px', fontSize: '0.7rem',
                          display: 'flex', alignItems: 'center', gap: '3px'
                        }}
                        title="Refresh the schedule based on latest timing data"
                      >
                        <Icon path={mdiCached} size={0.6} /> Regenerate
                      </button>
                    )}
                  </div>

                  {roundId && advancementStatuses[roundId] && (
                    <div style={{
                        background: '#e3f2fd',
                        border: '1px solid #bbdefb',
                        borderRadius: '6px',
                        padding: '10px',
                        marginBottom: '15px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#1565c0' }}>
                                {advancementStatuses[roundId].already_advanced ? 'Advancement Complete' : 'Auto-Advancement Pending'}
                            </span>
                        </div>
                        {!advancementStatuses[roundId].already_advanced && (
                            <div style={{ fontSize: '0.75rem', color: '#555' }}>
                                {advancementStatuses[roundId].is_ready 
                                    ? `Ready to advance ${advancementStatuses[roundId].advancing_racers.length} racers. Will populate automatically when previous rounds finish.`
                                    : 'Finish previous rounds to trigger auto-advancement.'}
                            </div>
                        )}
                        {!advancementStatuses[roundId].already_advanced && advancementStatuses[roundId].is_ready && (
                            <div style={{ fontSize: '0.7rem', color: '#666', fontStyle: 'italic' }}>
                                Predicted: {advancementStatuses[roundId].advancing_racers.map(r => r.last_name).join(', ')}
                            </div>
                        )}
                    </div>
                  )}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => handleDragEnd(event, roundNum)}
                  >
                    <SortableContext
                      items={roundHeats.map(h => h.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {roundHeats.map(heat => {
                          const isRunning = activeHeatId === heat.id;

                          return (
                            <SortableHeatCard
                              key={heat.id}
                              heat={heat}
                              isRunning={isRunning}
                              isReordering={reordering}
                              getRacerName={getRacerName}
                              onRunHeat={onRunHeat}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
