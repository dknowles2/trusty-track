import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface Standing {
  racer_id: number;
  avg_time: string;
  runs: number;
}

export default function Observation() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchData, 5000);
    fetchData();
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const config = await apiClient.get('/config/initial');
      if (config.current_race_id) {
          // Fetch heats to calculate standings on client side for MVP simplicity
          // Ideally backend providing /standings endpoint is better.
          // Let's implement client-side calculation for now as we didn't add /standings endpoint yet in crud.py
          // Wait, I put it in the plan but didn't implement it in crud.py execution step. 
          // I'll calculate here.
          const heatsData = await apiClient.get(`/races/${config.current_race_id}/heats`);
          calculateStandings(heatsData);
      }
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
                      <th style={{ padding: '15px' }}>Racer ID</th>
                      <th style={{ padding: '15px', textAlign: 'right' }}>Avg Time</th>
                      <th style={{ padding: '15px', textAlign: 'right' }}>Runs</th>
                  </tr>
              </thead>
              <tbody>
                  {standings.map((s, idx) => (
                      <tr key={s.racer_id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '15px', fontSize: '1.2rem', fontWeight: 'bold' }}>{idx + 1}</td>
                          <td style={{ padding: '15px' }}>#{s.racer_id}</td>
                          <td style={{ padding: '15px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.2rem' }}>{s.avg_time}s</td>
                          <td style={{ padding: '15px', textAlign: 'right' }}>{s.runs}</td>
                      </tr>
                  ))}
                  {standings.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center' }}>No results yet.</td></tr>
                  )}
              </tbody>
          </table>
      </div>
    </div>
  );
}
