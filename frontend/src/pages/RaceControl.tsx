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

  useEffect(() => {
    if (raceId) {
      setActiveRaceId(parseInt(raceId));
      fetchData(parseInt(raceId));
    }
  }, [raceId]);

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
        }
      } catch (e) {
        console.error("Failed to save results", e);
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

  if (loading) return <div>Loading Race Control...</div>;

  if (!activeRaceId) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  // Group Heats by Round
  const rounds: Record<number, Heat[]> = {};
  heats.forEach(h => {
      if (!rounds[h.round_number]) rounds[h.round_number] = [];
      rounds[h.round_number].push(h);
  });
  
  const sortedRounds = Object.keys(rounds).map(Number).sort((a,b) => a - b);

  return (
    <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Race Control</h1>
        <button 
          className="secondary-btn" 
          onClick={handleGenerateSchedule}
          disabled={generating}
        >
          {generating ? 'Generating...' : 'Regenerate Schedule'}
        </button>
      </div>

      {heats.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '8px' }}>
          <p>No heats scheduled.</p>
          <button className="primary-btn" onClick={handleGenerateSchedule}>Generate Schedule</button>
        </div>
      ) : (
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
                                            onClick={() => handleRunHeat(heat)}
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


