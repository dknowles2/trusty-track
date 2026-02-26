import React, { useState, useEffect } from 'react';
import { useQuery } from 'urql';
import Icon from '@mdi/react';
import { mdiDice5, mdiPencil, mdiShuffle, mdiFlagCheckered, mdiDragVertical } from '@mdi/js';
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
import { SerialProxyConnector } from './SerialProxyConnector';
import { TimerStatusBadge } from './TimerStatusBadge';
import { RacerCombobox } from '../../management/components/RacerCombobox';
import RacerAvatar from '../../management/components/RacerAvatar';

export interface LaneAssignment {
  id: string;
  lane: number;
  racerId: number | null;
}

interface FreeRaceLaneSetupProps {
  raceId: number;
  laneCount: number;
  onStart: (assignments: LaneAssignment[]) => void;
  timerType: string | null;
  trackId?: number | null;
}

interface Racer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
  racerImageUrl?: string;
}

type Mode = 'random' | 'manual';

interface SortableLaneItemProps {
  assignment: LaneAssignment;
  racer: Racer | null;
  mode: Mode;
  racers: Record<number, Racer>;
  allRacersList: Racer[];
  onManualChange: (lane: number, racerId: number | null) => void;
  manualAssignments: LaneAssignment[];
}

const SortableLaneItem: React.FC<SortableLaneItemProps> = ({
  assignment,
  racer,
  mode,
  racers,
  allRacersList,
  onManualChange,
  manualAssignments,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assignment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    padding: '15px',
    background: isDragging ? '#fff' : '#f9f9f9',
    borderRadius: '8px',
    borderLeft: '5px solid var(--scouting-blue)',
    boxShadow: isDragging ? '0 5px 15px rgba(0,0,0,0.1)' : 'none',
    zIndex: isDragging ? 100 : (isFocused ? 50 : 1),
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsFocused(false);
        }
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab',
          paddingRight: '15px',
          display: 'flex',
          alignItems: 'center',
          color: '#999',
          opacity: 0.6,
        }}
      >
        <Icon path={mdiDragVertical} size={1} />
      </div>

      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>
        Lane {assignment.lane}
      </div>

      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        overflow: 'hidden',
        marginRight: '15px',
        background: 'transparent',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        {assignment.racerId ? (
          <RacerAvatar
            racer={{
              id: assignment.racerId,
              first_name: racers[assignment.racerId]?.firstName || '',
              last_name: racers[assignment.racerId]?.lastName || '',
              racer_image_url: racers[assignment.racerId]?.racerImageUrl
            }}
            size="80px"
          />
        ) : (
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            border: '2px dashed #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ccc'
          }}>
            ?
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}>
        {mode === 'manual' ? (
          <RacerCombobox
            racers={allRacersList.filter((r) => {
              const takenByOther = manualAssignments.some(
                (other) => other.lane !== assignment.lane && other.racerId === r.id
              );
              return !takenByOther;
            })}
            value={assignment.racerId ?? undefined}
            onChange={(racerId) => onManualChange(assignment.lane, racerId ?? null)}
            placeholder="— Select racer —"
            style={{ minWidth: '350px' }}
          />
        ) : (
          assignment.racerId === null ? (
            <em style={{ color: '#999', fontSize: '1.2rem' }}>(empty)</em>
          ) : (
            <>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {racer?.firstName} {racer?.lastName}
              </div>
              {racer?.carNumber != null && (
                <div style={{ fontSize: '1rem', color: '#666' }}>
                  Car #{racer.carNumber}
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
};

export const FreeRaceLaneSetup: React.FC<FreeRaceLaneSetupProps & { racers: Record<number, Racer> }> = ({
  raceId,
  laneCount,
  onStart,
  racers,
  timerType,
  trackId,
}) => {
  const [mode, setMode] = useState<Mode>('random');
  const [manualAssignments, setManualAssignments] = useState<LaneAssignment[]>(
    Array.from({ length: laneCount }, (_, i) => ({ id: `manual-${i + 1}`, lane: i + 1, racerId: null }))
  );
  const [randomAssignments, setRandomAssignments] = useState<LaneAssignment[]>([]);

  const [randomResult, reExecuteRandom] = useQuery({
    query: `
      query GetRandomFreeRaceLanes($raceId: Int!) {
        randomFreeRaceLanes(raceId: $raceId) {
          lane
          racerId
        }
      }
    `,
    variables: { raceId },
    requestPolicy: 'network-only',
  });

  useEffect(() => {
    if (randomResult.data?.randomFreeRaceLanes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRandomAssignments(randomResult.data.randomFreeRaceLanes.map((l: { lane: number, racerId: number | null }, i: number) => ({
        id: `random-${i + 1}`,
        lane: l.lane,
        racerId: l.racerId
      })));
    }
  }, [randomResult.data]);

  const allRacersList = Object.values(racers);

  const handleReshuffle = () => {
    reExecuteRandom({ requestPolicy: 'network-only' });
  };

  const handleManualChange = (lane: number, racerId: number | null) => {
    setManualAssignments((prev) =>
      prev.map((a) => (a.lane === lane ? { ...a, racerId } : a))
    );
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragOver = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const current = mode === 'random' ? randomAssignments : manualAssignments;
      const set = mode === 'random' ? setRandomAssignments : setManualAssignments;

      const oldIndex = current.findIndex((a) => a.id === active.id);
      const newIndex = current.findIndex((a) => a.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(current, oldIndex, newIndex);
        const fixed = reordered.map((a, i) => ({
          ...a,
          lane: i + 1,
        }));
        set(fixed);
      }
    }
  };

  const handleDragEnd = () => {
    // Reordering is now handled in onDragOver for real-time feedback.
    // We can keep onDragEnd as a no-op or for any final persistence if needed.
  };

  const currentAssignments = mode === 'random' ? randomAssignments : manualAssignments;
  const hasAnyRacer = currentAssignments.some((a) => a.racerId != null);

  const showProxyControls = timerType === 'AUTO_DETECT_PROXY';

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--scouting-blue)' }}>
        {showProxyControls && trackId != null && (
          <SerialProxyConnector trackId={trackId} />
        )}
        <div style={{
          background: '#e3f2fd',
          border: '1px solid var(--scouting-blue)',
          borderRadius: '12px',
          padding: '10px 16px',
          marginBottom: '20px',
          fontWeight: 'bold',
          color: 'var(--scouting-blue)',
        }}>
          Free Race — results do not affect standings
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '2rem' }}>Free Race Setup</h2>
          {trackId != null && <TimerStatusBadge trackId={trackId} />}
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', background: '#e0e0e0', padding: '4px', borderRadius: '20px', marginBottom: '20px', width: 'fit-content', gap: '4px' }}>
          <button
            onClick={() => setMode('random')}
            style={{
              padding: '8px 20px',
              borderRadius: '16px',
              border: 'none',
              background: mode === 'random' ? 'white' : 'transparent',
              boxShadow: mode === 'random' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              fontWeight: mode === 'random' ? 'bold' : 'normal',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Icon path={mdiDice5} size={0.8} /> Random
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{
              padding: '8px 20px',
              borderRadius: '16px',
              border: 'none',
              background: mode === 'manual' ? 'white' : 'transparent',
              boxShadow: mode === 'manual' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              fontWeight: mode === 'manual' ? 'bold' : 'normal',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Icon path={mdiPencil} size={0.8} /> Manual
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {mode === 'random' && randomResult.fetching && randomAssignments.length === 0 ? (
            <p style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
              Loading random assignments...
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '15px', marginBottom: '20px' }}>
              <SortableContext
                items={currentAssignments.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {currentAssignments.map((a) => (
                  <SortableLaneItem
                    key={a.id}
                    assignment={a}
                    racer={a.racerId ? racers[a.racerId] : null}
                    mode={mode}
                    racers={racers}
                    allRacersList={allRacersList}
                    onManualChange={handleManualChange}
                    manualAssignments={manualAssignments}
                  />
                ))}
              </SortableContext>
            </div>
          )}
        </DndContext>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: mode === 'manual' ? 'flex-end' : 'flex-start' }}>
          {mode === 'random' && (
            <button
              onClick={handleReshuffle}
              disabled={randomResult.fetching}
              style={{
                padding: '10px 20px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Icon path={mdiShuffle} size={0.8} /> Re-shuffle
            </button>
          )}
          <button
            onClick={() => onStart(currentAssignments)}
            disabled={!hasAnyRacer || (mode === 'random' && randomResult.fetching && randomAssignments.length === 0)}
            className="primary-btn"
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              background: hasAnyRacer ? 'var(--scouting-blue)' : '#ccc',
              color: hasAnyRacer ? 'white' : '#999',
              cursor: hasAnyRacer ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Icon path={mdiFlagCheckered} size={0.8} /> Start Free Race Heat
          </button>
        </div>
      </div>
    </div>
  );
};
