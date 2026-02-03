import React, { useState, useEffect } from 'react';
import Modal from '../Modal';
import { FakeTimerMole } from './FakeTimerMole';

interface Heat {
  id: number;
  round_number: number;
  heat_number: number;
  lane_results: string; // JSON
}

interface RaceExecutionProps {
  activeExecutionHeat: Heat | null;
  nextExecutionHeat: Heat | null;
  activeHeatId: number | null;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void;
  onNextHeat: () => void;
  getRacerName: (id: number) => string;
  onUpdateResult: (heatId: number, results: any[]) => Promise<void>;
  timerType?: string | null;
}

export const RaceExecution: React.FC<RaceExecutionProps> = ({
  activeExecutionHeat,
  nextExecutionHeat,
  activeHeatId,
  onRunHeat,
  onNextHeat,
  getRacerName,
  onUpdateResult,
  timerType,
}) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResults, setEditingResults] = useState<any[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0.0);

  const results = activeExecutionHeat?.lane_results ? JSON.parse(activeExecutionHeat.lane_results) : [];
  const isCompleted = results.length > 0 && results[0].time !== null;
  const isRunning = activeHeatId !== null && activeHeatId === activeExecutionHeat?.id;

  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (isRunning) {
          const startTime = Date.now();
          setElapsedSeconds(0);
          interval = setInterval(() => {
              const now = Date.now();
              setElapsedSeconds((now - startTime) / 1000);
          }, 100);
      } else {
          setElapsedSeconds(0);
      }
      return () => {
          if (interval) clearInterval(interval);
      };
  }, [isRunning, activeHeatId]);

  if (!activeExecutionHeat) {
      return (
          <div style={{ textAlign: 'center', padding: '50px' }}>
              <h2>Race Complete! 🎉</h2>
              <p>All heats have been run.</p>
          </div>
      );
  }

  const handleEditOpen = () => {
    setEditingResults(JSON.parse(JSON.stringify(results))); // Deep copy
    setIsEditModalOpen(true);
  };

  const handleResultChange = (index: number, field: 'time' | 'place', value: string) => {
    const newResults = [...editingResults];
    newResults[index][field] = value;
    setEditingResults(newResults);
  };

  const handleSaveResults = async () => {
    await onUpdateResult(activeExecutionHeat.id, editingResults);
    setIsEditModalOpen(false);
  };

  const handleMoleFinish = async (newResults: any[]) => {
      await onUpdateResult(activeExecutionHeat.id, newResults);
  };

  const handleMoleStart = () => {
      console.log("Fake Timer Started via Mole");
      onRunHeat(activeExecutionHeat, true);
  };

  const showFakeControls = timerType === 'FAKE';

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--cub-scouting-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.heat_number}</h2>
                    <div style={{ color: '#666', fontSize: '1.1rem' }}>Round {activeExecutionHeat.round_number}</div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    {isCompleted ? (
                        <>
                            <button
                                onClick={handleEditOpen}
                                style={{
                                    padding: '10px 20px',
                                    fontSize: '1rem',
                                    background: '#f0f0f0',
                                    color: 'black',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                ✏️ Edit
                            </button>
                            <button
                                onClick={() => onRunHeat(activeExecutionHeat, false)}
                                style={{
                                    padding: '10px 20px',
                                    fontSize: '1rem',
                                    background: 'var(--cub-scouting-gold)', // Caution color
                                    color: 'black',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                ↺ Re-Run
                            </button>
                            {nextExecutionHeat && (
                                <button
                                    className="primary-btn"
                                    onClick={onNextHeat}
                                    style={{
                                        padding: '15px 30px',
                                        fontSize: '1.3rem',
                                        background: '#2e7d32', // Green for Go
                                        color: 'white',
                                        marginLeft: '10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    Next Heat ➡
                                </button>
                            )}
                        </>
                    ) : (
                        <div style={{ 
                            padding: '15px 30px', 
                            fontSize: '1.3rem',
                            background: isRunning ? 'orange' : '#e0e0e0',
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
              {results.map((r: any) => (
                  <div key={r.lane} style={{ display: 'flex', alignItems: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '8px', borderLeft: '5px solid #ddd' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {r.lane}</div>
                      <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{getRacerName(r.racer_id)}</div>
                      </div>
                      <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                          {r.time ? `${r.time}s` : '--'}
                      </div>
                  </div>
              ))}
          </div>
      </div>

      {/* Next Heat Preview */}
      {nextExecutionHeat && (
          <div style={{ marginTop: '30px', opacity: 0.7 }}>
              <h3>Up Next: Heat {nextExecutionHeat.heat_number} (Round {nextExecutionHeat.round_number})</h3>
              <div style={{ background: '#f0f0f0', padding: '15px', borderRadius: '8px' }}>
                  {(nextExecutionHeat.lane_results ? JSON.parse(nextExecutionHeat.lane_results) : []).map((r: any) => (
                      <span key={r.lane} style={{ display: 'inline-block', marginRight: '20px' }}>
                          <strong>L{r.lane}:</strong> {getRacerName(r.racer_id)}
                      </span>
                  ))}
              </div>
          </div>
      )}

      {/* Edit Results Modal */}
      <Modal 
          isOpen={isEditModalOpen} 
          onClose={() => setIsEditModalOpen(false)} 
          title={`Edit Results - Heat ${activeExecutionHeat.heat_number}`}
      >
          <div className="form-group">
            <p className="form-help">Manually update times for this heat.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Lane</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Racer</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Time (s)</th>
                </tr>
              </thead>
              <tbody>
                {editingResults.map((r: any, idx: number) => (
                  <tr key={r.lane} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{r.lane}</td>
                    <td style={{ padding: '8px' }}>{getRacerName(r.racer_id)}</td>
                    <td style={{ padding: '8px' }}>
                      <input 
                        type="number" 
                        step="0.0001" 
                        value={r.time || ''} 
                        onChange={(e) => handleResultChange(idx, 'time', e.target.value)}
                        className="form-control"
                        style={{ width: '100px' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="secondary-btn" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveResults}>Save Results</button>
            </div>
          </div>
      </Modal>

      {/* Fake Timer Mole */}
      <FakeTimerMole 
        isOpen={showFakeControls && !isCompleted}
        activeHeat={activeExecutionHeat}
        onTriggerFinish={handleMoleFinish}
        onTriggerStart={handleMoleStart}
      />
    </div>
  );
};
