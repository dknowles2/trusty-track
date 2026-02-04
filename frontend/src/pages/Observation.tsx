import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';

interface Standing {
  racer_id: number;
  avg_time: string;
  runs: number;
}

// Duplicate Heat interface to avoid shared dependency issues for now
interface Heat {
  id: number;
  round_number: number;
  round_id: number;
  heat_number: number;
  lane_results: string; // JSON
}

export default function Observation() {
  const { raceId } = useParams<{ raceId: string }>();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [racers, setRacers] = useState<Record<number, any>>({});
  const [currentHeat, setCurrentHeat] = useState<Heat | null>(null);
  const [nextHeat, setNextHeat] = useState<Heat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Poll for updates every 5 seconds
    if (raceId) {
        fetchRacers(parseInt(raceId));
        const interval = setInterval(() => fetchData(parseInt(raceId)), 5000);
        fetchData(parseInt(raceId));
        return () => clearInterval(interval);
    }
  }, [raceId]);

  const fetchRacers = async (id: number) => {
      try {
          const data = await apiClient.get(`/racers/?race_id=${id}`);
          const racerMap: Record<number, any> = {};
          data.forEach((r: any) => racerMap[r.id] = r);
          setRacers(racerMap);
      } catch (e) {
          console.error("Failed to fetch racers", e);
      }
  };

  const fetchData = async (id: number) => {
    try {
        const heatsData: Heat[] = await apiClient.get(`/races/${id}/heats`);
        calculateStandings(heatsData);
        determineUpcomingHeats(heatsData);
    } catch (e) {
      console.error("Fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  const determineUpcomingHeats = (heatsList: Heat[]) => {
      // Sort by round then heat
      const sorted = [...heatsList].sort((a, b) => {
          if (a.round_number !== b.round_number) return a.round_number - b.round_number;
          return a.heat_number - b.heat_number;
      });

      // Find first uncompleted heat
      const uncompleted = sorted.filter(h => {
          const results = h.lane_results ? JSON.parse(h.lane_results) : [];
          // Considered completed if results exist and have time
          return !(results.length > 0 && results[0].time !== null);
      });

      setCurrentHeat(uncompleted.length > 0 ? uncompleted[0] : null);
      setNextHeat(uncompleted.length > 1 ? uncompleted[1] : null);
  };

  const calculateStandings = (heatsList: any[]) => {
      const racerTimes: Record<number, number[]> = {};
      
      heatsList.forEach(heat => {
          if (!heat.lane_results) return;
          const results = JSON.parse(heat.lane_results);
          results.forEach((r: any) => {
              if (r.time) {
                  if (!racerTimes[r.racer_id]) racerTimes[r.racer_id] = [];
                  racerTimes[r.racer_id].push(parseFloat(r.time));
              }
          });
      });

      const calculated = Object.keys(racerTimes).map(rIds => {
          const rId = parseInt(rIds);
          const times = racerTimes[rId];
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          return {
              racer_id: rId,
              avg_time: avg.toFixed(4),
              runs: times.length
          };
      });

      calculated.sort((a, b) => parseFloat(a.avg_time) - parseFloat(b.avg_time));
      setStandings(calculated);
  };

  const renderHeatCard = (title: string, heat: Heat | null, isNext: boolean = false) => {
      if (!heat) return (
        <div style={{ flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '20px', textAlign: 'center', opacity: 0.7 }}>
            <h3>{title}</h3>
            <p>No heat scheduled</p>
        </div>
      );

      const assignments = heat.lane_results ? JSON.parse(heat.lane_results) : [];

      return (
          <div style={{ flex: 1, background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderTop: `5px solid ${isNext ? '#999' : 'var(--scouting-blue)'}` }}>
              <h2 style={{ marginTop: 0, fontSize: '1.5rem', color: isNext ? '#666' : '#333' }}>
                  {title} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#666' }}>(Round {heat.round_number}, Heat {heat.heat_number})</span>
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
                  {assignments.map((a: any) => {
                      const racer = racers[a.racer_id];
                      return (
                          <div key={a.lane} style={{ textAlign: 'center', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>
                              <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#888' }}>Lane {a.lane}</div>
                              {racer?.racer_image_url ? (
                                  <img 
                                    src={racer.racer_image_url} 
                                    alt="Racer" 
                                    style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto 5px', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} 
                                  />
                              ) : (
                                  <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 5px', fontWeight: 'bold', color: '#999' }}>
                                      #{a.racer_id}
                                  </div>
                              )}
                              <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                                  {racer ? `${racer.first_name} ${racer.last_name}` : `#{a.racer_id}`}
                              </div>
                              {racer?.car_number && <div style={{ fontSize: '0.8rem', color: '#666' }}>Car #{racer.car_number}</div>}
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  if (loading) return <div>Loading Standings...</div>;

  return (
    <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
      
      {/* Active Racing Section */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
          {renderHeatCard("🔥 Now Racing", currentHeat)}
          {renderHeatCard("🔜 On Deck", nextHeat, true)}
      </div>

      <h1>Live Standings</h1>
      
      <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--cub-scouting-gold)', color: '#333' }}>
                  <tr>
                      <th style={{ padding: '15px' }}>Rank</th>
                      <th style={{ padding: '15px' }}>Racer</th>
                      <th style={{ padding: '15px', textAlign: 'right' }}>Avg Time</th>
                      <th style={{ padding: '15px', textAlign: 'right' }}>Runs</th>
                  </tr>
              </thead>
              <tbody>
                  {standings.map((s, idx) => {
                      const racer = racers[s.racer_id];
                      return (
                      <tr key={s.racer_id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#333' }}>
                             {idx + 1}
                          </td>
                          <td style={{ padding: '15px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                  {racer?.racer_image_url ? (
                                      <img 
                                        src={racer.racer_image_url} 
                                        alt="Racer" 
                                        style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: '3px solid white', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }} 
                                      />
                                  ) : (
                                       <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#888' }}>
                                           #{s.racer_id}
                                       </div>
                                  )}
                                  <div>
                                      <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                                          {racer ? `${racer.first_name} ${racer.last_name}` : `Racer #${s.racer_id}`}
                                      </div>
                                      {racer?.car_number && (
                                          <div style={{ color: '#666', fontSize: '0.9rem' }}>Car #{racer.car_number} • {racer.rank}</div>
                                      )}
                                  </div>
                              </div>
                          </td>
                          <td style={{ padding: '15px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 'bold' }}>{s.avg_time}s</td>
                          <td style={{ padding: '15px', textAlign: 'right', fontSize: '1.1rem' }}>{s.runs}</td>
                      </tr>
                  )})}
                  {standings.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center' }}>No results yet.</td></tr>
                  )}
              </tbody>
          </table>
      </div>
    </div>
  );
}
