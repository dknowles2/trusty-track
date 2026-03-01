import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useSubscription } from 'urql';
import { FakeTimerMole } from './FakeTimerMole';
import { SerialProxyConnector } from './SerialProxyConnector';
import { TIMER_STATUS_SUBSCRIPTION } from '../graphql/queries';
import Modal from '../../../components/ui/Modal';
import Icon from '@mdi/react';
import { mdiRefresh, mdiPencil, mdiRacingHelmet, mdiTrophy, mdiCloseOctagon, mdiAlertCircleOutline } from '@mdi/js';
import { LaneAssignment } from './FreeRaceLaneSetup';
import RacerAvatar from '../../management/components/RacerAvatar';
import { TimerStatusBadge } from './TimerStatusBadge';
import { useAlert } from '../../../context/AlertContext';

const RESET_TIMER = `
  mutation ResetTimer($trackId: Int!) {
    resetTimer(trackId: $trackId)
  }
`;

interface RacerSummary {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
  racerImageUrl?: string;
}

interface FreeRaceExecutionProps {
  heatId: number;
  laneAssignments: LaneAssignment[];
  racers: Record<number, RacerSummary>;
  timerType: string | null;
  trackId?: number | null;
  onRunAnother: () => void;
  debugMode?: boolean;
}

interface LaneResult {
  lane: number;
  racer_id: number | null;
  time: number | null;
  place: number | null;
}

const RECORD_FREE_RACE_RESULT = `
  mutation RecordFreeRaceResult($heatId: Int!, $results: String!) {
    recordFreeRaceResult(heatId: $heatId, results: $results) {
      id
      laneResults
    }
  }
`;

const DELETE_FREE_RACE_HEAT = `
  mutation DeleteFreeRaceHeat($heatId: Int!) {
    deleteFreeRaceHeat(heatId: $heatId)
  }
`;

export const FreeRaceExecution: React.FC<FreeRaceExecutionProps> = ({
  heatId,
  laneAssignments,
  racers,
  timerType,
  trackId,
  onRunAnother,
}) => {
  const { showConfirm } = useAlert();
  const [results, setResults] = useState<LaneResult[] | null>(null);
  const lastPreparedIdRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResults, setEditingResults] = useState<LaneResult[]>([]);

  const [, recordResult] = useMutation(RECORD_FREE_RACE_RESULT);
  const [, deleteFreeRaceHeat] = useMutation(DELETE_FREE_RACE_HEAT);
  const [, resetTimer] = useMutation(RESET_TIMER);
  const [, prepareHeat] = useMutation(`
    mutation PrepareHeat($heatId: Int!) {
      prepareHeat(heatId: $heatId)
    }
  `);

  // Subscribe to the specific free race heat to get results when they arrive
  const [heatSubResult] = useSubscription({
    query: `
      subscription FreeRaceHeat($heatId: Int!) {
        freeRaceHeat(heatId: $heatId) {
          id
          laneResults
        }
      }
    `,
    variables: { heatId },
  });

  const [prevLaneResults, setPrevLaneResults] = useState<string | undefined>(undefined);
  const currentLaneResults = heatSubResult.data?.freeRaceHeat?.laneResults;

  if (currentLaneResults !== prevLaneResults) {
    setPrevLaneResults(currentLaneResults);
    setResults(currentLaneResults ? JSON.parse(currentLaneResults) : null);
  }

  // Subscribe to timer status
  const [subResult] = useSubscription({
    query: TIMER_STATUS_SUBSCRIPTION,
    variables: { trackId: trackId ?? 0 },
    pause: !trackId,
  });

  const timerState: string = subResult.data?.timerStatus?.status?.state ?? 'IDLE';

  // Results are completed if we have lane_results from the backend
  // In Phase 1, we expect the backend to record results automatically
  // but we might need to fetch them if they aren't in props yet.
  // Actually, FreeRaceTab might give us the updated heat.
  // For now, let's just drive isRunning/isCompleted from timerState and local state

  const isRunning = timerState === 'RUNNING';
  const isCompleted = results !== null;

  // Reset timer state when it stops
  const [prevIsRunning, setPrevIsRunning] = useState(isRunning);
  if (isRunning !== prevIsRunning) {
    setPrevIsRunning(isRunning);
    if (!isRunning) {
      setElapsedSeconds(0);
    }
  }

  // Auto-prepare heat when a new heatId is provided
  useEffect(() => {
    if (timerState === 'IDLE' && !results && heatId) {
      if (heatId !== lastPreparedIdRef.current) {
        prepareHeat({ heatId });
        lastPreparedIdRef.current = heatId;
      }
    }
    // Only run when heatId, timerState or results changes
  }, [heatId, timerState, results, prepareHeat]);


  // Timer for elapsed display
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  const openEditModal = () => {
    const base = results
      ? results
      : laneAssignments.map((a) => ({
        lane: a.lane,
        racer_id: a.racerId,
        time: null as number | null,
        place: null as number | null,
      }));
    setEditingResults(base.map((r) => ({ ...r })));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    // Re-sort by time and assign places
    const withTimes = editingResults.filter(
      (r) => r.racer_id !== null && r.time !== null
    );
    withTimes.sort((a, b) => (a.time ?? 9999) - (b.time ?? 9999));
    withTimes.forEach((r, idx) => { r.place = idx + 1; });

    const finalResults = editingResults.map((r) => {
      const found = withTimes.find((w) => w.lane === r.lane);
      return found ?? { ...r, place: null };
    });

    const res = await recordResult({
      heatId,
      results: JSON.stringify(finalResults),
    });

    if (res.data?.recordFreeRaceResult?.laneResults) {
      setResults(JSON.parse(res.data.recordFreeRaceResult.laneResults));
    } else {
      setResults(finalResults);
    }

    setIsEditModalOpen(false);
  };

  const handleSkipHeat = async () => {
    const confirmed = await showConfirm(
      "Are you sure you want to skip this heat? It will be deleted and no results will be recorded.",
      "Skip Heat",
      "Skip & Delete",
      "danger"
    );
    if (confirmed) {
      await deleteFreeRaceHeat({ heatId });
      if (trackId) await resetTimer({ trackId });
      onRunAnother();
    }
  };

  const handleResetHeat = async () => {
    const confirmed = await showConfirm(
      isCompleted
        ? "This will clear the current results and allow you to run this heat again."
        : "This will reset the timer and re-arm it for this heat.",
      "Reset Heat",
      "Reset",
      "danger"
    );
    if (confirmed) {
      if (isCompleted) {
        await recordResult({
          heatId,
          results: "null",
        });
        setResults(null);
      }
      if (trackId) await resetTimer({ trackId });
      await prepareHeat({ heatId });
    }
  };

  const getRacerDisplay = (racerId: number | null) => {
    if (racerId === null) return null;
    const r = racers[racerId];
    if (!r) return `Racer #${racerId}`;
    return `${r.firstName} ${r.lastName}${r.carNumber != null ? ` #${r.carNumber}` : ''}`;
  };

  const pendingResults = subResult.data?.timerStatus?.status?.pendingResults ?? [];

  const laneResultMap: Record<number, LaneResult> = {};
  if (results) {
    results.forEach((r) => { laneResultMap[r.lane] = r; });
  } else {
    // Show pending results if official results aren't in yet
    pendingResults.forEach((r: { lane: number; time: number | null; place: number | null }) => {
      laneResultMap[r.lane] = {
        lane: r.lane,
        racer_id: laneAssignments.find(a => a.lane === r.lane)?.racerId ?? null,
        time: r.time,
        place: r.place,
      };
    });
  }

  const showProxyControls = timerType === 'AUTO_DETECT_PROXY';

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--scouting-blue)' }}>
        {showProxyControls && trackId != null && (
          <SerialProxyConnector trackId={trackId} />
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '2rem' }}>Free Race Heat</h2>
              {trackId != null && <TimerStatusBadge trackId={trackId} />}
              <Icon path={mdiRacingHelmet} size={1.2} color="var(--scouting-blue)" />
            </div>
            <div style={{
              background: '#e3f2fd',
              borderRadius: '12px',
              padding: '4px 12px',
              fontSize: '0.85rem',
              fontWeight: 'bold',
              color: 'var(--scouting-blue)',
              marginTop: '5px',
              display: 'inline-block'
            }}>
              Results do not affect standings
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {isCompleted ? (
              <>
                <button
                  onClick={handleResetHeat}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.9rem',
                    background: '#fff3e0',
                    color: '#e65100',
                    border: '1px solid #ffe0b2',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Icon path={mdiRefresh} size={0.7} /> Reset Heat
                </button>
                <button
                  onClick={openEditModal}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.9rem',
                    background: '#f0f0f0',
                    color: 'black',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Icon path={mdiPencil} size={0.7} /> Edit
                </button>
                <button
                  onClick={onRunAnother}
                  className="primary-btn"
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.9rem',
                    background: 'var(--scouting-blue)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Icon path={mdiRefresh} size={0.7} /> Run Another
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{
                  padding: '8px 20px',
                  fontSize: '1.15rem',
                  background: isRunning ? '#ff9800' : '#f5f5f5',
                  color: isRunning ? 'white' : '#666',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  border: isRunning ? 'none' : '1px solid #ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  {isRunning && <span className="pulse-dot" style={{ width: '12px', height: '12px', background: 'white', borderRadius: '50%' }} />}
                  {isRunning ? `Racing... ${elapsedSeconds.toFixed(1)}s` : 'Waiting for Timer...'}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleResetHeat}
                    className="secondary-btn"
                    style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Icon path={mdiRefresh} size={0.6} /> Reset Heat
                  </button>
                  <button
                    onClick={openEditModal}
                    className="secondary-btn"
                    style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Icon path={isRunning ? mdiAlertCircleOutline : mdiPencil} size={0.6} />
                    {isRunning ? 'Force Results' : 'Override'}
                  </button>
                  <button
                    onClick={handleSkipHeat}
                    className="secondary-btn"
                    style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Icon path={mdiCloseOctagon} size={0.6} /> Skip Heat
                  </button>
                </div>
                <style>{`
                      .pulse-dot { animation: pulse 1s infinite; }
                      @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
                  `}</style>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: '15px' }}>
          {laneAssignments.map((a) => {
            const r = laneResultMap[a.lane];
            const racer = a.racerId ? racers[a.racerId] : null;
            const isEmpty = a.racerId === null;

            return (
              <div key={a.lane} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '15px',
                background: '#f9f9f9',
                borderRadius: '8px',
                borderLeft: '5px solid var(--scouting-blue)',
                opacity: isEmpty ? 0.6 : 1
              }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {a.lane}</div>

                <div style={{
                  flex: 1,
                  padding: '10px 15px',
                  background: r?.place === 1 ? 'rgba(0, 63, 135, 0.05)' : 'transparent',
                  border: r?.place === 1 ? '1px solid var(--scouting-blue)' : '1px solid transparent',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', marginRight: '15px', background: 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <RacerAvatar
                      racer={{
                        id: a.racerId || 0,
                        first_name: racer?.firstName || '',
                        last_name: racer?.lastName || '',
                        racer_image_url: racer?.racerImageUrl
                      }}
                      size="80px"
                    />
                  </div>

                  <div style={{ flex: 1 }}>
                    {isEmpty ? (
                      <em style={{ color: '#999', fontSize: '1.3rem' }}>(empty)</em>
                    ) : (
                      <>
                        <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{racer?.firstName} {racer?.lastName}</div>
                        {racer?.carNumber != null && <div style={{ fontSize: '0.9rem', color: '#666' }}>Car #{racer.carNumber}</div>}
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {r?.time != null ? `${Number(r.time).toFixed(4)}s` : '--'}
                    </div>
                    {r?.place != null && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        width: '60px',
                        padding: '5px',
                        borderRadius: '8px',
                        background: r.place === 1 ? 'var(--scouting-blue)' :
                          r.place === 2 ? '#e0e0e0' :
                            r.place === 3 ? '#d7a48d' : 'transparent',
                        color: r.place === 1 ? 'white' : 'inherit',
                        boxShadow: r.place <= 3 ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                      }}>
                        {r.place <= 3 ? (
                          <Icon
                            path={mdiTrophy}
                            size={1}
                            color={r.place === 1 ? 'white' :
                              r.place === 2 ? '#757575' : '#8d6e63'}
                          />
                        ) : (
                          <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{r.place}th</span>
                        )}
                        {r.place <= 3 && <span style={{ fontSize: '0.7rem', fontWeight: 'bold', lineHeight: 1 }}>
                          {r.place === 1 ? '1st' : r.place === 2 ? '2nd' : '3rd'}
                        </span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fake timer mole */}
      {timerType === 'FAKE' && (
        <FakeTimerMole
          isOpen={!isCompleted}
          heatId={heatId}
          trackId={trackId ?? 0}
        />
      )}

      {/* Edit results modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Free Race Results">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {editingResults.map((r, idx) => (
            <div key={r.lane} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ minWidth: '60px', fontWeight: 'bold', color: '#666' }}>Lane {r.lane}</span>
              <span style={{ flex: 1 }}>
                {r.racer_id === null ? <em style={{ color: '#999' }}>(empty)</em> : getRacerDisplay(r.racer_id)}
              </span>
              <input
                type="number"
                step="0.0001"
                value={r.time ?? ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? null : parseFloat(e.target.value);
                  setEditingResults((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, time: val } : x))
                  );
                }}
                placeholder="Time (s)"
                style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', width: '120px', textAlign: 'right' }}
                disabled={r.racer_id === null}
              />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button onClick={() => setIsEditModalOpen(false)} style={{ padding: '8px 18px', borderRadius: '6px', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSaveEdit} style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#d32f2f', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>
              Save Results
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
