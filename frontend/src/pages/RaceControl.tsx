import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';

interface Heat {
  id: number;
  round_number: number;
  heat_number: number;
  lane_results: string; // JSON
}

export default function RaceControl() {
  const { raceId } = useParams<{ raceId: string }>();
  const [activeRaceId, setActiveRaceId] = useState<number | null>(null);
  const [heats, setHeats] = useState<Heat[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeHeatId, setActiveHeatId] = useState<number | null>(null);

  useEffect(() => {
    if (raceId) {
      setActiveRaceId(parseInt(raceId));
      fetchHeats(parseInt(raceId));
    }
  }, [raceId]);

  const fetchHeats = async (id: number) => {
    try {
      const data = await apiClient.get(`/races/${id}/heats`);
      setHeats(data);
    } catch (e) {
      console.error("Failed to fetch heats", e);
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
      alert("Failed to generate schedule");
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
        if (activeRaceId) fetchHeats(activeRaceId);
      } catch (e) {
        console.error("Failed to save results", e);
      } finally {
        setActiveHeatId(null);
      }
    }, 2000); // 2 second race simulation
  };

  if (loading) return <div>Loading Race Control...</div>;

  if (!activeRaceId) return (
    <div className="container">
      <h1>Race Control</h1>
      <p>No active race found. Please return home and select a race.</p>
    </div>
  );

  return (
    <div className="container">
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
        <div style={{ display: 'grid', gap: '15px' }}>
            {heats.map(heat => {
                const results = heat.lane_results ? JSON.parse(heat.lane_results) : [];
                const isCompleted = results.length > 0 && results[0].time !== null;
                const isRunning = activeHeatId === heat.id;

                return (
                    <div key={heat.id} style={{ 
                        background: '#fff', padding: '15px', borderRadius: '8px',
                        borderLeft: isRunning ? '5px solid orange' : isCompleted ? '5px solid green' : '5px solid #ccc'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>Round {heat.round_number} - Heat {heat.heat_number}</h3>
                            {(!isCompleted || isRunning) && (
                                <button 
                                    className="primary-btn"
                                    onClick={() => handleRunHeat(heat)}
                                    disabled={isRunning}
                                    style={{ padding: '5px 10px', fontSize: '0.9rem' }}
                                >
                                    {isRunning ? 'Racing...' : isCompleted ? 'Re-Run' : 'Start Heat'}
                                </button>
                            )}
                        </div>
                        <div style={{ marginTop: '10px', fontSize: '0.9rem' }}>
                            {results.map((r: any) => (
                                <div key={r.lane} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 100px', padding: '4px 0' }}>
                                    <span style={{ fontWeight: 'bold' }}>L{r.lane}</span>
                                    <span>Racer #{r.racer_id}</span>
                                    <span style={{ textAlign: 'right' }}>
                                        {r.time ? `${r.time}s` : '-'}
                                        {r.place ? ` (${r.place}${getOrdinal(r.place)})` : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
      )}
    </div>
  );
}

function getOrdinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
