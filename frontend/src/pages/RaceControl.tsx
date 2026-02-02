import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';

interface Heat {
  id: number;
  round_number: number;
  heat_number: number;
  lane_results: string; // JSON
}

// Add Racer interface
interface Racer {
  id: number;
  first_name: string;
  last_name: string;
  car_number: number;
}

export default function RaceControl() {
  const { raceId } = useParams<{ raceId: string }>();
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [heats, setHeats] = useState<Heat[]>([]);
  const [racers, setRacers] = useState<Record<number, Racer>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);

  useEffect(() => {
    if (raceId) {
      setActiveRaceId(parseInt(raceId));
      fetchData(parseInt(raceId));
    }
  }, [raceId]);

  // Initialize selectedHeatId to first uncompleted heat when heats load
  useEffect(() => {
      if (heats.length > 0 && selectedHeatId === null) {
          const sorted = [...heats].sort((a, b) => {
            if (a.round_number !== b.round_number) return a.round_number - b.round_number;
            return a.heat_number - b.heat_number;
          });
          
          const firstUncompleted = sorted.find(h => {
              const results = h.lane_results ? JSON.parse(h.lane_results) : [];
              return !(results.length > 0 && results[0].time !== null);
          });
          
          if (firstUncompleted) {
              setSelectedHeatId(firstUncompleted.id);
          } else if (sorted.length > 0) {
              // All completed, default to last
              setSelectedHeatId(sorted[sorted.length - 1].id);
          }
      }
  }, [heats, selectedHeatId]);

  const fetchData = async (id: number) => {
      setLoading(true);
      try {
          const [heatsData, racersData] = await Promise.all([
              apiClient.get(`/races/${id}/heats`),
              apiClient.get(`/racers/?race_id=${id}`)
          ]);
          setHeats(heatsData);
          
          const racerMap: Record<number, Racer> = {};
          racersData.forEach((r: Racer) => {
              racerMap[r.id] = r;
          });
          setRacers(racerMap);
          
      } catch (e) {
          console.error("Failed to fetch race data", e);
      } finally {
          setLoading(false);
      }
  };

  const handleGenerateSchedule = async () => {
    if (!activeRaceId) return;
    setGenerating(true);
    try {
      const data = await apiClient.post(`/races/${activeRaceId}/generate_heats`, {});
      setHeats(data);
      setSelectedHeatId(null); // Reset selection to trigger re-init
    } catch (e) {
      console.error("Failed to generate", e);
      alert("Failed to generate schedule. Ensure you have at least 2 racers.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunHeat = async (heat: Heat) => {
    setActiveHeatId(heat.id);
    // Simulate race duration
    setTimeout(async () => {
      // Generate random results for lanes
      // Parse existing lane_results to keep assignments
      const assignments = JSON.parse(heat.lane_results || '[]');
      const results = assignments.map((a: any) => ({
        ...a,
        time: (3.0 + Math.random()).toFixed(4),
        place: 0 // logic to sort places later
      }));
      
      // Sort to assign places
      results.sort((a: any, b: any) => parseFloat(a.time) - parseFloat(b.time));
      results.forEach((r: any, idx: number) => r.place = idx + 1);

      try {
        await apiClient.put(`/heats/${heat.id}`, { 
          ...heat, 
          lane_results: JSON.stringify(results) 
        });
        
        // Update local state without full refetch if possible, but refetch is safer for sync
        if (activeRaceId) {
            const updatedHeats = await apiClient.get(`/races/${activeRaceId}/heats`);
            setHeats(updatedHeats);
            // NOTE: We do NOT update selectedHeatId here, satisfying "no auto-advance"
        }
      } catch (e) {
        console.error("Failed to save results", e);
        alert("Failed to save race results. Please try again.");
      } finally {
        setActiveHeatId(null);
      }
    }, 2000); // 2 second race simulation
  };

  const getRacerName = (id: number) => {
      const r = racers[id];
      if (!r) return `Racer #${id}`;
      return `${r.first_name} ${r.last_name} (#${r.car_number})`;
  };

  // ... existing state ...
  const [viewMode, setViewMode] = useState<'SCHEDULE' | 'EXECUTION'>('SCHEDULE');

  // ... (keep existing useEffects and handlers) ...

  // Derived state for Execution Mode
  const sortedHeatsEx = [...heats].sort((a, b) => {
      if (a.round_number !== b.round_number) return a.round_number - b.round_number;
      return a.heat_number - b.heat_number;
  });
  
  // Use selectedHeatId for active execution heat
  const activeExecutionHeat = selectedHeatId 
      ? sortedHeatsEx.find(h => h.id === selectedHeatId)
      : (sortedHeatsEx.length > 0 ? sortedHeatsEx[0] : null); // Fallback until effect runs
      
  const currentIndex = activeExecutionHeat 
      ? sortedHeatsEx.findIndex(h => h.id === activeExecutionHeat.id) 
      : -1;
      
  const nextExecutionHeat = currentIndex !== -1 && currentIndex + 1 < sortedHeatsEx.length 
      ? sortedHeatsEx[currentIndex + 1] 
      : null;

  const handleNextHeat = () => {
      if (nextExecutionHeat) {
          setSelectedHeatId(nextExecutionHeat.id);
      }
  };

  // Auto-switch to execution mode if we have heats? Optional. 
  // Let's default to SCHEDULE for overview, but user can switch.

  if (loading) return <div>Loading Race Control...</div>;

  if (!activeRaceId) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  // Group Heats by Round for Schedule View
  const rounds: Record<number, Heat[]> = {};
  heats.forEach(h => {
      if (!rounds[h.round_number]) rounds[h.round_number] = [];
      rounds[h.round_number].push(h);
  });
  
  const sortedRounds = Object.keys(rounds).map(Number).sort((a,b) => a - b);

  return (
    <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Race Control</h1>
        
        {/* Mode Switcher and Actions - Centered */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifySelf: 'center' }}>
            <div style={{ display: 'flex', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button 
                    onClick={() => setViewMode('SCHEDULE')}
                    style={{ 
                        padding: '8px 20px', 
                        borderRadius: '20px', 
                        border: 'none', 
                        background: viewMode === 'SCHEDULE' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'SCHEDULE' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'SCHEDULE' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    📅 Schedule
                </button>
                <button 
                    onClick={() => setViewMode('EXECUTION')}
                    style={{ 
                        padding: '8px 20px', 
                        borderRadius: '20px', 
                        border: 'none', 
                        background: viewMode === 'EXECUTION' ? 'white' : 'transparent',
                        boxShadow: viewMode === 'EXECUTION' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                        fontWeight: viewMode === 'EXECUTION' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    🏁 Race
                </button>
            </div>

            {viewMode === 'SCHEDULE' && (
                <button 
                  className="secondary-btn" 
                  onClick={handleGenerateSchedule}
                  disabled={generating}
                >
                  {generating ? 'Generating...' : 'Regenerate Schedule'}
                </button>
            )}
        </div>

        {/* Action Button - Right Aligned (Empty now, but kept for grid balance if needed, or remove) */}
        <div style={{ justifySelf: 'end' }}>
            {/* Empty to maintain grid structure if we want title-center-right 1fr-auto-1fr balance */}
        </div>
      </div>

      {heats.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '8px' }}>
          <p>No heats scheduled.</p>
          <button className="primary-btn" onClick={handleGenerateSchedule}>Generate Schedule</button>
        </div>
      ) : viewMode === 'EXECUTION' ? (
          // --- EXECUTION MODE ---
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              {activeExecutionHeat ? (
                  <>
                    <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--cub-scouting-gold)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                             <div>
                                 <h2 style={{ margin: 0, fontSize: '2rem' }}>Heat {activeExecutionHeat.heat_number}</h2>
                                 <div style={{ color: '#666', fontSize: '1.1rem' }}>Round {activeExecutionHeat.round_number}</div>
                             </div>
                             <div style={{ display: 'flex', gap: '10px' }}>
                                 {(() => {
                                     const results = activeExecutionHeat.lane_results ? JSON.parse(activeExecutionHeat.lane_results) : [];
                                     const isCompleted = results.length > 0 && results[0].time !== null;
                                     const isRunning = activeHeatId === activeExecutionHeat.id;
                                     
                                     // State: Running -> Disable all
                                     // State: Completed -> Show "Next Heat" (Primary) and "Re-Run" (Secondary)
                                     // State: Ready -> Show "Start Heat" (Primary)
                                     
                                     if (isCompleted) {
                                        return (
                                            <>
                                                {/* Re-Run Button (Secondary/Caution) */}
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Are you sure you want to re-run this heat? Previous results will be overwritten.')) {
                                                            handleRunHeat(activeExecutionHeat);
                                                        }
                                                    }}
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

                                                {/* Next Heat Button (Primary/Action) */}
                                                {nextExecutionHeat && (
                                                    <button
                                                        className="primary-btn"
                                                        onClick={handleNextHeat}
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
                                        );
                                     }
                                     
                                     return (
                                        <button 
                                            className="primary-btn"
                                            onClick={() => handleRunHeat(activeExecutionHeat)}
                                            disabled={isRunning}
                                            style={{ 
                                                padding: '15px 30px', 
                                                fontSize: '1.3rem',
                                                background: isRunning ? 'orange' : 'var(--scouting-blue)'
                                            }}
                                        >
                                            {isRunning ? 'Racing...' : 'Start Heat'}
                                        </button>
                                     );
                                 })()}
                             </div>
                        </div>
                        
                        <div style={{ display: 'grid', gap: '15px' }}>
                            {(activeExecutionHeat.lane_results ? JSON.parse(activeExecutionHeat.lane_results) : []).map((r: any) => (
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
                  </>
              ) : (
                  <div style={{ textAlign: 'center', padding: '50px' }}>
                      <h2>Race Complete! 🎉</h2>
                      <p>All heats have been run.</p>
                  </div>
              )}
          </div>
      ) : (
        // --- SCHEDULE MODE (Bracket View) ---
        <div style={{ 
            display: 'flex', 
            overflowX: 'auto', 
            gap: '20px', 
            paddingBottom: '20px',
            alignItems: 'flex-start'
        }}>
            {sortedRounds.map(roundNum => (
                <div key={roundNum} style={{ 
                    minWidth: '350px', 
                    background: '#f5f5f5', 
                    borderRadius: '8px', 
                    padding: '10px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    <h3 style={{ textAlign: 'center', margin: '0 0 15px 0', color: 'var(--scouting-blue)' }}>Round {roundNum}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {rounds[roundNum].map(heat => {
                            const results = heat.lane_results ? JSON.parse(heat.lane_results) : [];
                            const isCompleted = results.length > 0 && results[0].time !== null;
                            const isRunning = activeHeatId === heat.id;
                            
                            return (
                                <div key={heat.id} style={{ 
                                    background: '#fff', padding: '15px', borderRadius: '8px',
                                    borderLeft: isRunning ? '5px solid orange' : isCompleted ? '5px solid green' : '5px solid #ccc',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                        <span style={{ fontWeight: 'bold' }}>Heat {heat.heat_number}</span>
                                        <button 
                                            className="primary-btn"
                                            onClick={() => {
                                                // Switch to execution mode and run? Or just run in place?
                                                // Let's run in place for schedule view consistency, or switch?
                                                // User might want to "jump to" this heat in execution mode.
                                                // For now, keep existing behavior: Run in place.
                                                handleRunHeat(heat);
                                            }}
                                            disabled={isRunning}
                                            style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: '60px' }}
                                        >
                                            {isRunning ? '...' : isCompleted ? 'Re-Run' : 'Run'}
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.85rem' }}>
                                        {results.map((r: any) => (
                                            <div key={r.lane} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                                                <span style={{ fontWeight: 'bold', width: '30px', color: '#666' }}>L{r.lane}</span>
                                                <span style={{ flex: 1, paddingLeft: '5px' }}>{getRacerName(r.racer_id)}</span>
                                                <span style={{ textAlign: 'right', minWidth: '50px', fontFamily: 'monospace' }}>
                                                    {r.time ? `${r.time}s` : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
      )}
    </div>
  );
}


