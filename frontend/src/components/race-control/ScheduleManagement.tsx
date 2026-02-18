import React, { useState } from 'react';
import { RoundConfigModal } from './RoundConfigModal';
import { RoundWizard } from './RoundWizard';
import Icon from '@mdi/react';
import { mdiCached, mdiPlus, mdiDragVertical, mdiAutoFix, mdiDelete } from '@mdi/js';
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
import { useAlert } from '../../context/AlertContext';

export interface Heat {
  id: number;
  roundNumber: number;
  roundName: string | null;
  roundId: number;
  heatNumber: number;
  laneResults: string; // JSON
}

interface ScheduleManagementProps {
  raceId: number;
  heats: Heat[];
  generating: boolean;
  activeHeatId: number | null;
  onAddRound: (config: any) => Promise<void>;
  onRegenerateRound: (roundId: number, silent?: boolean) => Promise<void>;
  onDeleteRound: (roundId: number) => Promise<void>;
  onRefetchHeats: () => Promise<void>;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  onReorderHeats: (updates: { heat_id: number, new_heat_number: number }[]) => Promise<void>;
  getRacerName: (id: number) => string;
  laneCount: number;
  racerCount: number;
  denCount: number;
  championshipTrophies: number;
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
  const laneResults = heat.laneResults ? JSON.parse(heat.laneResults) : [];
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
            <span style={{ fontWeight: 'bold' }}>Heat {heat.heatNumber}</span>
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
  onDeleteRound,
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
  const { showToast } = useAlert();

  const rounds = heats.reduce((acc, heat) => {
    if (!acc[heat.roundNumber]) {
      acc[heat.roundNumber] = [];
    }
    acc[heat.roundNumber].push(heat);
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

  const sortedRounds = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const hasGeneralRound = Object.values(rounds).some(roundHeats => {
      // In GraphQL we might need a better way to identify general rounds
      // but if roundNumber is small or name is 'All Pack'
      return roundHeats[0].roundName === 'All Pack' || roundHeats[0].roundNumber === 1;
  });

  const handleAddRound = async (config: any) => {
    await onAddRound(config);
  };

  const handleDragEnd = async (event: DragEndEvent, roundNum: number) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const roundHeats = rounds[roundNum].sort((a, b) => a.heatNumber - b.heatNumber);
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
    } catch (error: any) {
      console.error('Failed to reorder heats:', error);
      showToast(error.message || 'Failed to reorder heats', 'error');
    } finally {
      setReordering(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 'fit-content' }}>
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
              const roundHeats = rounds[roundNum].sort((a, b) => a.heatNumber - b.heatNumber);
              const roundId = roundHeats[0]?.roundId;
              const isAnyStarted = roundHeats.some(h => {
                if (!h.laneResults) return false;
                const res = JSON.parse(h.laneResults);
                return res.some((r: any) => r.time !== null);
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
                      {roundHeats[0]?.roundName || `Round ${roundNum}`}
                    </h3>
                    <div style={{ display: 'flex', gap: '5px', position: 'absolute', right: 0 }}>
                      {!isAnyStarted && roundId && (
                        <button
                          onClick={() => onRegenerateRound(roundId)}
                          className="secondary-btn"
                          disabled={generating || reordering}
                          style={{
                               padding: '2px 8px', fontSize: '0.7rem',
                            display: 'flex', alignItems: 'center', gap: '3px'
                          }}
                        >
                          <Icon path={mdiCached} size={0.6} /> Regenerate
                        </button>
                      )}
                      {roundId && (
                        <button
                          onClick={() => onDeleteRound(roundId)}
                          className="secondary-btn"
                          disabled={generating || reordering || isAnyStarted}
                          style={{
                            padding: '2px 8px', fontSize: '0.7rem',
                            display: 'flex', alignItems: 'center', gap: '3px',
                            color: '#d32f2f',
                          }}
                        >
                          <Icon path={mdiDelete} size={0.6} /> Delete
                        </button>
                      )}
                    </div>
                  </div>

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
