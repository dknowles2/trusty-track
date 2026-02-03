import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface LeaderboardEntry {
  racer_id: number;
  first_name: string;
  last_name: string;
  car_number: number;
  den_name: string;
  score: number;
  heats_completed: number;
  rank: number;
}

interface LeaderboardData {
  race_id: number;
  scoring_strategy: string;
  leaderboard: LeaderboardEntry[];
}

interface LeaderboardProps {
  raceId: number;
}

export default function Leaderboard({ raceId }: LeaderboardProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, [raceId]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/races/${raceId}/scores`);
      setData(response);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '20px' }}>Loading standings...</div>;
  }

  if (!data || data.leaderboard.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', background: '#f9f9f9', borderRadius: '8px' }}>
        <p>No results yet. Complete some heats to see standings!</p>
      </div>
    );
  }

  const scoreLabel = data.scoring_strategy === 'TIMED' ? 'Avg Time' : 'Points';
  const formatScore = (score: number, strategy: string) => {
    if (strategy === 'TIMED') {
      return `${score.toFixed(3)}s`;
    }
    return score.toString();
  };

  const getRankMedal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  };

  const getRankStyle = (rank: number) => {
    if (rank === 1) return { background: '#ffd700', fontWeight: 'bold' as const };
    if (rank === 2) return { background: '#c0c0c0', fontWeight: 'bold' as const };
    if (rank === 3) return { background: '#cd7f32', fontWeight: 'bold' as const };
    return {};
  };

  return (
    <div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '15px' 
      }}>
        <h2 style={{ margin: 0 }}>Current Standings</h2>
        <button 
          className="secondary-btn" 
          onClick={fetchLeaderboard}
          style={{ padding: '8px 16px', fontSize: '0.9rem' }}
        >
          Refresh
        </button>
      </div>

      <div style={{ 
        background: '#fff', 
        borderRadius: '8px', 
        overflow: 'hidden',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--scouting-blue)', color: 'white' }}>
              <th style={{ padding: '12px', textAlign: 'left', width: '60px' }}>Rank</th>
              <th style={{ padding: '12px', textAlign: 'left', width: '80px' }}>Car #</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Den</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Heats</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>{scoreLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((entry, index) => (
              <tr 
                key={entry.racer_id}
                style={{
                  ...getRankStyle(entry.rank),
                  borderBottom: index < data.leaderboard.length - 1 ? '1px solid #eee' : 'none'
                }}
              >
                <td style={{ padding: '12px', fontSize: '1.1rem' }}>
                  {getRankMedal(entry.rank)} {entry.rank}
                </td>
                <td style={{ padding: '12px', fontWeight: 'bold' }}>
                  {entry.car_number}
                </td>
                <td style={{ padding: '12px' }}>
                  {entry.first_name} {entry.last_name}
                </td>
                <td style={{ padding: '12px', color: '#666' }}>
                  {entry.den_name}
                </td>
                <td style={{ padding: '12px', textAlign: 'center', color: '#666' }}>
                  {entry.heats_completed}
                </td>
                <td style={{ 
                  padding: '12px', 
                  textAlign: 'right', 
                  fontFamily: 'monospace',
                  fontSize: '1.05rem',
                  fontWeight: entry.rank <= 3 ? 'bold' : 'normal'
                }}>
                  {entry.heats_completed > 0 
                    ? formatScore(entry.score, data.scoring_strategy)
                    : '-'
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ 
        marginTop: '10px', 
        fontSize: '0.85rem', 
        color: '#666', 
        textAlign: 'center' 
      }}>
        {data.scoring_strategy === 'TIMED' 
          ? 'Lower average time is better'
          : 'Lower total points is better (1st place = 1 point, 2nd = 2 points, etc.)'
        }
      </div>
    </div>
  );
}
