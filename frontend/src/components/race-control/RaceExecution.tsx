import React, { useState, useEffect } from 'react';
import Modal from '../Modal';
import { FakeTimerMole } from './FakeTimerMole';
import Icon from '@mdi/react';
import { mdiTrophy, mdiPencil, mdiRefresh, mdiArrowRight, mdiAccount, mdiChevronRight } from '@mdi/js';

interface Heat {
  id: number;
  advancement_num_racers: number | null;
  advancement_source: string | null;
  round_number: number;
  round_id: number;
  heat_number: number;
  round_name: string | null;
  lane_results: string; // JSON
  total_participants: number;
}

interface Racer {
  id: number;
  first_name: string;
  last_name: string;
  car_number: number;
  racer_image_url?: string;
  car_image_url?: string;
}

interface AdvancementRacer {
    racer_id: number;
    first_name: string;
    last_name: string;
    car_number: number | null;
    den_name: string;
    score: number;
    rank: number;
    is_advancing: boolean;
}

interface AdvancementStatus {
    is_ready: boolean;
    requires_advancement: boolean;
    already_advanced: boolean;
    advancing_racers: AdvancementRacer[];
    source: string | null;
    num_racers: number | null;
}


interface RaceExecutionProps {
  activeExecutionHeat: Heat | null;
  nextExecutionHeat: Heat | null;
  upcomingHeats: Heat[];
  activeHeatId: number | null;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  onStartTimer: (heatId: number) => void;
  onNextHeat: () => void;
  getRacerName: (id: number) => string;
  onUpdateResult: (heatId: number, results: any[]) => Promise<void>;
  timerType?: string | null;
  racers: Record<number, Racer>;
  roundSummary: AdvancementStatus | null;
}

export const RaceExecution: React.FC<RaceExecutionProps> = ({
  activeExecutionHeat,
  nextExecutionHeat,
  upcomingHeats,
  activeHeatId,
  onRunHeat,
  onStartTimer,
  onNextHeat,
  getRacerName,
  onUpdateResult,
  timerType,
  racers,
  roundSummary
}) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResults, setEditingResults] = useState<any[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0.0);
  const [isRoundSummaryOpen, setIsRoundSummaryOpen] = useState(!!roundSummary);

  const results = activeExecutionHeat?.lane_results ? JSON.parse(activeExecutionHeat.lane_results) : [];
  const isCompleted = results.length > 0 && results[0].time !== null;
  const isRunning = activeHeatId !== null && activeHeatId === activeExecutionHeat?.id;

  useEffect(() => {
    setIsRoundSummaryOpen(!!roundSummary);
  }, [roundSummary]);

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
              <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" style={{ marginBottom: '20px' }} />
              <h2 style={{ fontSize: '2.5rem', marginTop: 0 }}>Race Complete!</h2>
              <p style={{ fontSize: '1.2rem', color: '#666' }}>All heats have been run.</p>
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
      if (isCompleted) {
          console.warn("Ignoring fake timer finish: results already recorded.");
          return;
      }
      await onUpdateResult(activeExecutionHeat.id, newResults);
  };

  const handleMoleStart = () => {
      console.log("Fake Timer Started via Mole");
      if (activeExecutionHeat) {
          onStartTimer(activeExecutionHeat.id);
      }
  };

  const showFakeControls = timerType === 'FAKE';

  return (
    <>
      <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        
        {/* LEFT COLUMN: Active Heat */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Active Heat Card */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--cub-scouting-gold)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <div>
                          <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.heat_number}</h2>
                          <div style={{ color: '#666', fontSize: '1.1rem' }}>
                              {activeExecutionHeat.round_name || `Round ${activeExecutionHeat.round_number}`}
                          </div>
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
                                          fontWeight: 'bold',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '5px'
                                      }}
                                  >
                                      <Icon path={mdiPencil} size={0.7} /> Edit
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
                                          fontWeight: 'bold',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '5px'
                                      }}
                                  >
                                      <Icon path={mdiRefresh} size={0.7} /> Re-Run
                                  </button>
                                  {nextExecutionHeat && (!roundSummary || !isRoundSummaryOpen) && (
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
                                          Next Heat <Icon path={mdiArrowRight} size={0.8} />
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
                    {results.map((r: any) => {
                        const racer = racers[r.racer_id];
                        return (
                          <div key={r.lane} style={{ display: 'flex', alignItems: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '8px', borderLeft: '5px solid #ddd' }}>
                              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {r.lane}</div>
                              
                              {/* Racer Image */}
                              <div style={{ width: '60px', height: '60px', borderRadius: '50%', overflow: 'hidden', marginRight: '15px', background: '#eee', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                  {racer?.racer_image_url ? (
                                      <img src={racer.racer_image_url} alt="Racer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                      <Icon path={mdiAccount} size={1.5} color="#ccc" />
                                  )}
                              </div>

                              <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{getRacerName(r.racer_id)}</div>
                                  {racer && <div style={{ fontSize: '0.9rem', color: '#666' }}>{racer.car_number ? `#${racer.car_number}` : ''}</div>}
                              </div>
                              <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                  {r.time ? `${r.time}s` : '--'}
                              </div>
                          </div>
                        );
                    })}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: Upcoming Heats */}
        <div>
            <h3 style={{ marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
               <Icon path={mdiChevronRight} size={1} /> Upcoming
            </h3>
            <div style={{ background: 'white', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                {upcomingHeats.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                        No more upcoming heats.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {upcomingHeats.map(h => (
                            <div key={h.id} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #eee', background: '#fafafa' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Heat {h.heat_number}</span>
                                    <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'normal' }}>Round {h.round_number}</span>
                                </div>
                                <div style={{ fontSize: '0.85rem' }}>
                                    {(h.lane_results ? JSON.parse(h.lane_results) : []).map((r: any) => (
                                        <div key={r.lane} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                            <span style={{ color: '#666' }}>L{r.lane}:</span>
                                            <span style={{ fontWeight: '500' }}>{getRacerName(r.racer_id)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* Round Summary Modal */}
      <Modal 
          isOpen={!!roundSummary && isRoundSummaryOpen} 
          onClose={() => setIsRoundSummaryOpen(false)} 
          title="Round Complete!"
      >
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <Icon path={mdiTrophy} size={3} color="var(--cub-scouting-gold)" />
              <p style={{ fontSize: '1.2rem', color: '#666', marginTop: '10px' }}>
                  {roundSummary?.requires_advancement 
                      ? `Top ${roundSummary.num_racers} racers advance to the next round.`
                      : "This round is complete."
                  }
              </p>
              {roundSummary?.source && (
                  <div style={{ fontSize: '0.9rem', color: '#888', fontStyle: 'italic' }}>
                      Advancement Source: {roundSummary.source}
                  </div>
              )}
          </div>

          {roundSummary && (
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px', marginBottom: '20px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                          <tr>
                              <th style={{ padding: '10px', textAlign: 'left' }}>Rank</th>
                              <th style={{ padding: '10px', textAlign: 'left' }}>Racer</th>
                              <th style={{ padding: '10px', textAlign: 'right' }}>Score</th>
                          </tr>
                      </thead>
                      <tbody>
                          {roundSummary.advancing_racers.map((ar, idx) => (
                              <tr key={ar.racer_id} style={{ borderBottom: '1px solid #eee', background: ar.is_advancing ? '#fff8e1' : 'white' }}>
                                  <td style={{ padding: '10px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                          {idx < 3 && <Icon path={mdiTrophy} size={0.7} color={idx === 0 ? 'gold' : idx === 1 ? 'silver' : '#cd7f32'} />}
                                          {idx + 1}
                                      </div>
                                  </td>
                                  <td style={{ padding: '10px' }}>
                                      <div style={{ fontWeight: 'bold' }}>{ar.first_name} {ar.last_name}</div>
                                      <div style={{ fontSize: '0.8rem', color: '#666' }}>{ar.den_name} #{ar.car_number}</div>
                                  </td>
                                  <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
                                      {ar.score.toFixed(3)}
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
               <button
                    className="primary-btn"
                    onClick={onNextHeat}
                    style={{
                        padding: '15px 40px',
                        fontSize: '1.2rem',
                        background: '#2e7d32',
                        color: 'white',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
                    }}
                >
                    Start Next Round <Icon path={mdiArrowRight} size={1} />
                </button>
          </div>
      </Modal>

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
        isOpen={showFakeControls}
        activeHeat={activeExecutionHeat}
        isRunning={isRunning}
        isCompleted={isCompleted}
        onTriggerFinish={handleMoleFinish}
        onTriggerStart={handleMoleStart}
      />
    </>
  );
};
