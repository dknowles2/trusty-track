import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';

interface Standing {
  racer_id: number;
  avg_time: string;
  runs: number;
}

export default function Observation() {
  const { raceId } = useParams<{ raceId: string }>();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [racers, setRacers] = useState<Record<number, any>>({});
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
        const heatsData = await apiClient.get(`/races/${id}/heats`);
        calculateStandings(heatsData);
    } catch (e) {
      console.error("Fetch error", e);
    } finally {
      setLoading(false);
    }
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

  if (loading) return <div>Loading Standings...</div>;

  return (
    <div className="container">
      <h1>Live Standings</h1>
      
      <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: 'var(--scout-gold)', color: '#333' }}>
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
