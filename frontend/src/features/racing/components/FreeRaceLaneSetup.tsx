import React, { useState } from 'react';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiDice5, mdiPencil, mdiShuffle, mdiFlagCheckered, mdiDragVertical, mdiCloseOctagon, mdiIncognito } from '@mdi/js';
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

// Three ways to fill the lanes, and anonymous is one of them rather than a
// state the other two can fall into. It used to be reachable only by leaving
// every lane empty, so the button relabelled itself and nothing on screen said
// the mode existed — the operator testing the track had to discover it.
export type Mode = 'random' | 'manual' | 'anonymous';

const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: 'random', label: 'Random', icon: mdiDice5 },
  { key: 'manual', label: 'Manual', icon: mdiPencil },
  { key: 'anonymous', label: 'Anonymous', icon: mdiIncognito },
];

interface FreeRaceLaneSetupProps {
  raceId: number;
  laneCount: number;
  /** Lanes permanently out of service on the track (System Settings). */
  laneOutages: number[];
  /**
   * Lanes the operator has switched off for this free-race session only —
   * lasts as long as the tab stays open, never written to the track. Lifted
   * to the parent so it survives "Next Heat" the same way `mode` does.
   */
  disabledLanes: number[];
  onToggleLane: (lane: number) => void;
  onStart: (assignments: LaneAssignment[]) => void;
  timerType: string | null;
  trackId?: number | null;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

interface Racer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
  racerImageUrl?: string | null;
}

const laneCard = {
  display: 'flex',
  alignItems: 'center',
  padding: '15px',
  borderRadius: '8px',
  borderLeft: '5px solid var(--scouting-blue)',
} as const;

const laneNumber = {
  fontSize: '1.2rem',
  fontWeight: 'bold',
  width: '80px',
  color: '#666',
} as const;

/**
 * A lane in an anonymous heat.
 *
 * Deliberately not the empty-lane treatment the other two modes use: a lane
 * here is not empty, it is unnamed — a car runs in it and the time is kept
 * against the lane. "No racer" beside a dashed avatar said the opposite, and
 * read as a lane nobody would be racing in.
 */
const AnonymousLaneItem: React.FC<{ lane: number }> = ({ lane }) => (
  <div style={{ ...laneCard, background: '#f9f9f9', padding: '14px 15px' }}>
    <div style={laneNumber}>Lane {lane}</div>
    <div style={{ flex: 1, color: '#777' }}>Any car</div>
  </div>
);

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
  laneOutages,
  disabledLanes,
  onToggleLane,
  onStart,
  racers,
  timerType,
  trackId,
  mode,
  onModeChange,
}) => {
  // Every physical lane the track has — the one place `i + 1` is the right
  // lane number, because this *is* the definition of "the track's lanes".
  // Everything downstream reads lane numbers off `enabledLanes` instead, not
  // off a position in some filtered or reordered list (#303).
  const allLanes = React.useMemo(
    () => Array.from({ length: laneCount }, (_, i) => i + 1),
    [laneCount],
  );
  const outageSet = React.useMemo(() => new Set(laneOutages), [laneOutages]);
  const disabledSet = React.useMemo(() => new Set(disabledLanes), [disabledLanes]);
  const enabledLanes = React.useMemo(
    () => allLanes.filter((lane) => !outageSet.has(lane) && !disabledSet.has(lane)),
    [allLanes, outageSet, disabledSet],
  );
  const enabledLanesKey = enabledLanes.join(',');

  const [manualAssignments, setManualAssignments] = useState<LaneAssignment[]>(
    enabledLanes.map((lane) => ({ id: `manual-${lane}`, lane, racerId: null }))
  );
  // The operator may have half-filled the manual lanes when a lane comes on
  // or off — a racer already picked for a lane that is still enabled must
  // survive, and a lane that dropped out must not linger with a name in it.
  // Adjusted during render rather than in an effect, the same way
  // `RaceControl` pins its active heat: an effect would paint the stale
  // rows for a frame before correcting them.
  const [syncedLanesKey, setSyncedLanesKey] = useState(enabledLanesKey);
  if (enabledLanesKey !== syncedLanesKey) {
    setSyncedLanesKey(enabledLanesKey);
    const byLane = new Map(manualAssignments.map((a) => [a.lane, a]));
    setManualAssignments(
      enabledLanes.map(
        (lane) => byLane.get(lane) ?? { id: `manual-${lane}`, lane, racerId: null }
      )
    );
  }

  const [randomAssignments, setRandomAssignments] = useState<LaneAssignment[]>([]);

  // Which draw is on screen: 0 when the setup opens, then one per Re-shuffle.
  // It is a query variable rather than a bare refetch because the server's
  // draw may be seeded (`demo_seed`), and a draw keyed on the race alone comes
  // out identical however many times it is asked for — which is exactly what
  // the public demo does, so Re-shuffle there could not change anything.
  const [shuffle, setShuffle] = useState(0);

  const [randomResult] = useQuery({
    query: `
      query GetRandomFreeRaceLanes($raceId: Int!, $shuffle: Int!, $enabledLanes: [Int!]) {
        randomFreeRaceLanes(raceId: $raceId, shuffle: $shuffle, enabledLanes: $enabledLanes) {
          lane
          racerId
        }
      }
    `,
    // `enabledLanes` rides along as a query variable rather than a client
    // filter: the draw itself has to run over the right pool of racers for
    // the right number of lanes, which only the server can do.
    variables: { raceId, shuffle, enabledLanes },
    requestPolicy: 'network-only',
  });

  // Seeded from the server's shuffle, then the operator may drag lanes about —
  // so it is state, not a derivation. Reseeded during render whenever a new
  // shuffle arrives, including a reshuffle, rather than in an effect that
  // would paint the previous draw first.
  //
  // `shuffledFrom` starts at `undefined` rather than at the current data: a
  // query that has already resolved by the first render would otherwise look
  // like it had been seeded when it had not, and the lanes would come up empty.
  const [shuffledFrom, setShuffledFrom] = useState<typeof randomResult.data>(undefined);
  if (randomResult.data && randomResult.data !== shuffledFrom) {
    setShuffledFrom(randomResult.data);
    if (randomResult.data.randomFreeRaceLanes) {
      setRandomAssignments(randomResult.data.randomFreeRaceLanes.map((l: { lane: number, racerId: number | null }, i: number) => ({
        id: `random-${i + 1}`,
        lane: l.lane,
        racerId: l.racerId
      })));
    }
  }

  const allRacersList = Object.values(racers);

  // Not disabled while the draw is in flight: an operator clicking twice on a
  // slow connection had the second click swallowed and read that as the button
  // doing nothing. Counting the clicks is local, so each one asks a new
  // question and the last answer to arrive is the one on screen.
  const handleReshuffle = () => {
    setShuffle((n) => n + 1);
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
        // A card's *position* is not its lane number once a lane can be
        // missing from the list (#303) — `i + 1` put whatever was dragged
        // to the second slot into lane 2 even when lane 2 was disabled, and
        // it stopped lining up with the enabled lanes as soon as any earlier
        // lane was out. `enabledLanes[i]` is the physical lane the i-th card
        // actually sits over.
        const fixed = reordered.map((a, i) => ({
          ...a,
          lane: enabledLanes[i] ?? a.lane,
        }));
        set(fixed);
      }
    }
  };

  const handleDragEnd = () => {
    // Reordering is now handled in onDragOver for real-time feedback.
    // We can keep onDragEnd as a no-op or for any final persistence if needed.
  };

  // An anonymous heat is one empty lane per *enabled* lane (#303) — a lane
  // out of service or switched off for this session never gets a card, and
  // so never gets a row when the heat is started. Derived, not state: there
  // is nothing on it to edit, so nothing to remember.
  const anonymousAssignments = React.useMemo(
    () => enabledLanes.map((lane) => ({
      id: `anonymous-${lane}`,
      lane,
      racerId: null,
    })),
    [enabledLanes],
  );

  const currentAssignments =
    mode === 'random' ? randomAssignments
      : mode === 'manual' ? manualAssignments
        : anonymousAssignments;

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
          {MODES.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => onModeChange(key)}
              aria-pressed={mode === key}
              style={{
                padding: '8px 20px',
                borderRadius: '16px',
                border: 'none',
                background: mode === key ? 'white' : 'transparent',
                boxShadow: mode === key ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                fontWeight: mode === key ? 'bold' : 'normal',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Icon path={icon} size={0.8} /> {label}
            </button>
          ))}
        </div>

        {/* Per-lane toggle — session only, never written to the track (#303).
            A lane out of service is shown locked rather than left off the
            row, so an operator can see why it is not on offer. */}
        <div style={{ marginBottom: '20px' }} data-testid="lane-toggle-row">
          <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '6px' }}>
            Lanes for this session
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {allLanes.map((lane) => {
              const outOfService = outageSet.has(lane);
              const enabled = !outOfService && !disabledSet.has(lane);
              return (
                <label
                  key={lane}
                  title={
                    outOfService
                      ? 'This lane is out of service. Change it on the track in System Settings.'
                      : undefined
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: '1px solid ' + (outOfService ? '#eee' : enabled ? 'var(--scouting-blue)' : '#ccc'),
                    background: outOfService ? '#f5f5f5' : enabled ? '#e3f2fd' : 'white',
                    color: outOfService ? '#aaa' : '#333',
                    cursor: outOfService ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={outOfService}
                    onChange={() => onToggleLane(lane)}
                  />
                  Lane {lane}{outOfService ? ' — out of service' : ''}
                </label>
              );
            })}
          </div>
        </div>

        {mode === 'anonymous' && (
          <p style={{ color: '#666', marginTop: 0, marginBottom: '20px' }}>
            Put any car in any lane — the time is kept against the lane, not
            against a racer. Use it to test the track or the timer, or to run
            cars that are not on the roster.
          </p>
        )}

        <div data-testid="lane-cards">
          {enabledLanes.length === 0 ? (
            <p style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No lanes are enabled. Turn one on above to start a heat.
            </p>
          ) : mode === 'anonymous' ? (
            <div style={{ display: 'grid', gap: '15px', marginBottom: '20px' }}>
              {anonymousAssignments.map((a) => (
                <AnonymousLaneItem key={a.id} lane={a.lane} />
              ))}
            </div>
          ) : (
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
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            {mode === 'random' && (
              <button
                onClick={handleReshuffle}
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
            {mode === 'manual' && (
              <button
                onClick={() => setManualAssignments((prev) => prev.map((a) => ({ ...a, racerId: null })))}
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
                <Icon path={mdiCloseOctagon || mdiPencil} size={0.8} /> Clear All
              </button>
            )}
          </div>
          <button
            onClick={() => onStart(currentAssignments)}
            disabled={
              enabledLanes.length === 0 ||
              (mode === 'random' && randomResult.fetching && randomAssignments.length === 0)
            }
            className="primary-btn"
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              background: 'var(--scouting-blue)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Icon path={mdiFlagCheckered} size={0.8} />{' '}
            {mode === 'anonymous' ? 'Start Anonymous Heat' : 'Start Free Race Heat'}
          </button>
        </div>
      </div>
    </div>
  );
};
