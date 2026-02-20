import React, { useState, useEffect } from 'react';
import { useMutation } from 'urql';
import { FakeTimerMole } from './FakeTimerMole';
import Modal from '../Modal';
import Icon from '@mdi/react';
import { mdiRefresh, mdiPencil, mdiRacingHelmet } from '@mdi/js';
import { LaneAssignment } from './FreeRaceLaneSetup';
import RacerAvatar from '../RacerAvatar';

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
  onRunAnother: () => void;
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

const PLACE_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export const FreeRaceExecution: React.FC<FreeRaceExecutionProps> = ({
  heatId,
  laneAssignments,
  racers,
  timerType,
  onRunAnother,
}) => {
  const [results, setResults] = useState<LaneResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResults, setEditingResults] = useState<LaneResult[]>([]);

  const [, recordResult] = useMutation(RECORD_FREE_RACE_RESULT);

  // Timer for elapsed display
  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Build the "fake heat" object that FakeTimerMole expects
  const fakeHeat = {
    id: heatId,
    laneResults: JSON.stringify(
      laneAssignments.map((a) => ({
        lane: a.lane,
        racer_id: a.racerId,
        time: null,
        place: null,
      }))
    ),
  };

  const handleTimerStart = () => {
    setIsRunning(true);
  };

  const handleTimerFinish = async (generatedResults: LaneResult[]) => {
    setIsRunning(false);
    setIsCompleted(true);

    const res = await recordResult({
      heatId,
      results: JSON.stringify(generatedResults),
    });

    if (res.data?.recordFreeRaceResult?.laneResults) {
      setResults(JSON.parse(res.data.recordFreeRaceResult.laneResults));
    } else {
      setResults(generatedResults);
    }
  };

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

    setIsCompleted(true);
    setIsEditModalOpen(false);
  };

  const getRacerDisplay = (racerId: number | null) => {
    if (racerId === null) return null;
    const r = racers[racerId];
    if (!r) return `Racer #${racerId}`;
    return `${r.firstName} ${r.lastName}${r.carNumber != null ? ` #${r.carNumber}` : ''}`;
  };

  const laneResultMap: Record<number, LaneResult> = {};
  if (results) {
    results.forEach((r) => { laneResultMap[r.lane] = r; });
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--scouting-blue)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '2rem' }}>Free Race Heat</h2>
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
                  onClick={openEditModal}
                  style={{
                    padding: '10px 20px',
                    fontSize: '1rem',
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
                    padding: '10px 20px',
                    fontSize: '1rem',
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
              <div style={{
                padding: '15px 30px',
                fontSize: '1.3rem',
                background: isRunning ? '#ff9800' : '#e0e0e0',
                color: isRunning ? 'white' : '#666',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}>
                {isRunning ? `Racing... ${elapsedSeconds.toFixed(1)}s` : 'Waiting for Timer...'}
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

                {/* Racer Image */}
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', overflow: 'hidden', marginRight: '15px', background: 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <RacerAvatar
                    racer={{
                      id: a.racerId || 0,
                      first_name: racer?.firstName || '',
                      last_name: racer?.lastName || '',
                      racer_image_url: racer?.racerImageUrl
                    }}
                    size="60px"
                  />
                </div>

                <div style={{ flex: 1 }}>
                  {isEmpty ? (
                    <em style={{ color: '#999', fontSize: '1.3rem' }}>(empty)</em>
                  ) : (
                    <>
                      <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{racer?.firstName} {racer?.lastName}</div>
                      {racer?.carNumber != null && <div style={{ fontSize: '0.9rem', color: '#666' }}>#{racer.carNumber}</div>}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {r?.time != null ? `${Number(r.time).toFixed(4)}s` : '--'}
                  </div>
                  {r?.place != null && (
                    <div style={{ fontSize: '1.8rem', width: '40px', textAlign: 'center' }}>
                      {PLACE_MEDAL[r.place] ?? <span style={{ fontSize: '1.2rem', color: '#666' }}>{r.place}th</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fake timer mole */}
      {timerType === 'FAKE' && (
        <FakeTimerMole
          onTriggerFinish={handleTimerFinish}
          onTriggerStart={handleTimerStart}
          activeHeat={fakeHeat}
          isOpen={!isCompleted}
          isRunning={isRunning}
          isCompleted={isCompleted}
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
