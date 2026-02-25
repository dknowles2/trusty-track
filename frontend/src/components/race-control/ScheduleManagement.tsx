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



interface SortableHeatRowProps {
  heat: Heat;
  isRunning: boolean;
  isReordering: boolean;
  getRacerName: (id: number) => string;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  laneCount: number;
}

const getDisplayName = (id: number, getRacerName: (id: number) => string) => {
  if (id === null) return "Empty";
  if (id < 0) return `Placeholder ${Math.abs(id)}`;
  return getRacerName(id);
};

const SortableHeatRow: React.FC<SortableHeatRowProps> = ({
  heat,
  isRunning,
  isReordering,
  getRacerName,
  onRunHeat,
  laneCount
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
    background: isDragging ? '#f5f5f5' : 'white',
    borderLeft: isRunning ? '5px solid orange' : isCompleted ? '5px solid green' : '5px solid transparent',
  };

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
        title={hasResults ? "Cannot reorder completed heats" : isRunning ? "Cannot reorder running heat" : "Drag to reorder"}
      >
        <Icon path={mdiDragVertical} size={0.8} color="#999" />
      </td>
      <td style={{ padding: '12px', fontWeight: 'bold', width: '80px' }}>Heat {heat.heatNumber}</td>
      {Array.from({ length: laneCount }).map((_, i) => {
        const laneNum = i + 1;
        const result = laneResults.find((r: any) => r.lane === laneNum);
        return (
          <td key={laneNum} style={{ padding: '8px 12px', borderLeft: '1px solid #f0f0f0' }}>
            {result ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{getDisplayName(result.racer_id, getRacerName)}</span>
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
        <button
          className="primary-btn"
          onClick={() => onRunHeat(heat, !isCompleted)}
          disabled={isRunning}
          style={{ padding: '4px 12px', fontSize: '0.8rem', minWidth: '70px' }}
        >
          {isRunning ? '...' : isCompleted ? 'Re-Run' : 'Run'}
        </button>
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: '1200px' }}>
        <div style={{ display: 'flex', justifyContent: sortedRounds.length > 0 ? 'space-between' : 'flex-end', alignItems: 'center', marginBottom: '20px', gap: '20px' }}>
          {sortedRounds.length > 0 && (
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#333' }}>
                {sortedRounds.length} Round{sortedRounds.length > 1 ? 's' : ''} Scheduled
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
                className="primary-btn"
                onClick={() => setIsModalOpen(true)}
                disabled={generating || reordering || sortedRounds.some(r => (rounds[r][0]?.roundName || '').toLowerCase().includes('final'))}
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
            flexDirection: 'column',
            gap: '40px',
            paddingBottom: '40px',
          }}>
            {sortedRounds.map(roundNum => {
              const roundHeats = (rounds[roundNum] || []).sort((a, b) => a.heatNumber - b.heatNumber);
              const roundId = roundHeats[0]?.roundId;
              const isAnyStarted = roundHeats.some(h => {
                if (!h.laneResults) return false;
                const res = JSON.parse(h.laneResults);
                return res.some((r: any) => r.time !== null);
              });

              return (
                <div key={roundNum} style={{
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
                    <h2 style={{ 
                      margin: 0, 
                      color: 'var(--scouting-blue)', 
                      textAlign: 'left',
                      fontSize: '1.5rem'
                    }}>
                      {roundHeats[0]?.roundName || `Round ${roundNum}`}
                    </h2>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      {!isAnyStarted && roundId && (
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
                      {roundId && (
                        <button
                          onClick={() => onDeleteRound(roundId)}
                          className="secondary-btn"
                          disabled={generating || reordering || isAnyStarted || roundNum < Math.max(...sortedRounds)}
                          aria-label={`Delete ${roundHeats[0]?.roundName || `Round ${roundNum}`}`}
                          title={
                              isAnyStarted 
                                ? "Cannot delete round: it has heats with results" 
                                : roundNum < Math.max(...sortedRounds)
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
                      onDragEnd={(event) => handleDragEnd(event, roundNum)}
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
                                getRacerName={getRacerName}
                                onRunHeat={onRunHeat}
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
