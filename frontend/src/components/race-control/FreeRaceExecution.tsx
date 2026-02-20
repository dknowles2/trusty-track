import React, { useState, useEffect } from 'react';
import { useMutation } from 'urql';
import { FakeTimerMole } from './FakeTimerMole';
import Modal from '../Modal';
import Icon from '@mdi/react';
import { mdiRefresh, mdiPencil } from '@mdi/js';
import { LaneAssignment } from './FreeRaceLaneSetup';

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
    <div style={{ background: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Free Race Heat</h2>
        <span style={{
          background: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: '12px',
          padding: '3px 12px',
          fontSize: '0.8rem',
          fontWeight: 'bold',
          color: '#856404',
        }}>
          Results do not affect standings
        </span>
      </div>

      {/* Lane results table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '10px', textAlign: 'left', color: '#666' }}>Lane</th>
            <th style={{ padding: '10px', textAlign: 'left', color: '#666' }}>Racer</th>
            <th style={{ padding: '10px', textAlign: 'right', color: '#666' }}>Time</th>
            <th style={{ padding: '10px', textAlign: 'right', color: '#666' }}>Place</th>
          </tr>
        </thead>
        <tbody>
          {laneAssignments.map((a) => {
            const r = laneResultMap[a.lane];
            const name = getRacerDisplay(a.racerId);
            const isEmpty = a.racerId === null;
            return (
              <tr key={a.lane} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 10px', fontWeight: 'bold', color: '#666' }}>Lane {a.lane}</td>
                <td style={{ padding: '12px 10px' }}>
                  {isEmpty ? <em style={{ color: '#999' }}>(empty)</em> : name}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.1rem' }}>
                  {r?.time != null ? `${Number(r.time).toFixed(4)}s` : <span style={{ color: '#bbb' }}>—</span>}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontSize: '1.3rem' }}>
                  {r?.place != null ? (PLACE_MEDAL[r.place] ?? `${r.place}th`) : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Status / actions */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {!isCompleted && !isRunning && (
          <span style={{ color: '#888' }}>Waiting for timer...</span>
        )}
        {isRunning && (
          <span style={{ color: '#ff9800', fontWeight: 'bold' }}>
            Racing... {elapsedSeconds.toFixed(1)}s
          </span>
        )}
        {isCompleted && (
          <>
            <button
              onClick={openEditModal}
              style={{
                padding: '10px 18px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Icon path={mdiPencil} size={0.8} /> Edit Results
            </button>
            <button
              onClick={onRunAnother}
              style={{
                padding: '10px 18px',
                border: 'none',
                borderRadius: '6px',
                background: '#1976d2',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Icon path={mdiRefresh} size={0.8} /> Run Another Free Race Heat
            </button>
          </>
        )}
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
