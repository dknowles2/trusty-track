import { useState } from 'react';
import { useQuery, useSubscription } from 'urql';
import { LeaderboardSubscription } from '../../observation/graphql/queries';
import RacerAvatar from '../../management/components/RacerAvatar';

export interface LeaderboardEntry {
  racerId: number;
  firstName: string;
  lastName: string;
  carNumber: number;
  denName: string;
  score: number;
  heatsCompleted: number;
  rank: number;
  racerImageUrl?: string;
}

const GET_LEADERBOARD_METADATA = `
  query GetLeaderboardMetadata($raceId: Int!) {
    race(raceId: $raceId) {
      id
      scoringStrategy
      rounds {
        id
        name
        roundNumber
        advancementSource
      }
    }
  }
`;

// Standings for one round. The live subscription only carries the default
// prelim standings, so a championship round is fetched on demand instead.
const GET_ROUND_STANDINGS = `
  query GetRoundStandings($raceId: Int!, $roundId: Int!) {
    race(raceId: $raceId) {
      id
      leaderboard(roundId: $roundId) {
        racerId
        firstName
        lastName
        carNumber
        denName
        score
        heatsCompleted
        rank
        racerImageUrl
      }
    }
  }
`;

interface RoundSummary {
  id: number;
  name?: string | null;
  roundNumber: number;
  advancementSource?: string | null;
}

interface LeaderboardProps {
  raceId: number;
}

export default function Leaderboard({ raceId }: LeaderboardProps) {
  // null means the overall standings, which cover preliminary rounds only.
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  const [queryResult] = useQuery({
    query: GET_LEADERBOARD_METADATA,
    variables: { raceId },
    requestPolicy: 'cache-and-network',
  });

  const [subscriptionResult] = useSubscription({
    query: LeaderboardSubscription,
    variables: { raceId },
    pause: !raceId || isNaN(raceId)
  });

  const [roundResult] = useQuery({
    query: GET_ROUND_STANDINGS,
    variables: { raceId, roundId: selectedRoundId },
    pause: selectedRoundId === null,
    requestPolicy: 'cache-and-network',
  });

  const { data: queryData, fetching: queryFetching, error: queryError } = queryResult;
  const { data: subscriptionData, error: subscriptionError } = subscriptionResult;

  if (queryFetching && !subscriptionData) {
    return <div style={{ textAlign: 'center', padding: '20px' }}>Loading standings...</div>;
  }

  if (queryError || subscriptionError) {
    return <div style={{ textAlign: 'center', padding: '20px', color: 'red' }}>Error loading standings</div>;
  }

  const race = queryData?.race;
  const rounds = (race?.rounds || []) as RoundSummary[];
  const championshipRounds = rounds.filter((r) => r.advancementSource);

  const leaderboard = (
    selectedRoundId === null
      ? subscriptionData?.leaderboard || []
      : roundResult.data?.race?.leaderboard || []
  ) as LeaderboardEntry[];

  const scoringStrategy = race?.scoringStrategy || 'TIMED';

  const hasResults = leaderboard.some((entry: LeaderboardEntry) => entry.heatsCompleted > 0);
  const stillLoading = queryFetching || roundResult.fetching;

  if (!race || (leaderboard.length === 0 && !stillLoading) || (!hasResults && !stillLoading)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', background: '#f9f9f9', borderRadius: '8px' }}>
        <p>No results yet. Complete some heats to see standings!</p>
      </div>
    );
  }

  const roundLabel = (r: RoundSummary) => r.name || `Round ${r.roundNumber}`;

  const scoreLabel = scoringStrategy === 'TIMED' ? 'Avg Time' : 'Points';
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
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '15px'
      }}>
        <h2 style={{ margin: 0 }}>
          {selectedRoundId === null
            ? 'Current Standings'
            : roundLabel(rounds.find((r) => r.id === selectedRoundId)!)}
        </h2>

        {championshipRounds.length > 0 && (
          <select
            aria-label="Standings scope"
            value={selectedRoundId ?? ''}
            onChange={(e) => setSelectedRoundId(e.target.value === '' ? null : parseInt(e.target.value))}
            style={{ padding: '8px 12px', borderRadius: '12px', border: '1px solid #ccc' }}
          >
            <option value="">Overall (preliminary rounds)</option>
            {championshipRounds.map((r) => (
              <option key={r.id} value={r.id}>{roundLabel(r)}</option>
            ))}
          </select>
        )}
      </div>

      {selectedRoundId === null && championshipRounds.length > 0 && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 14px',
          background: '#f3f6fb',
          borderLeft: '4px solid var(--scouting-blue)',
          borderRadius: '12px',
          fontSize: '0.9rem',
          color: '#444'
        }}>
          Overall standings cover the preliminary rounds. Championship results are
          listed separately — pick a round above.
        </div>
      )}

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
              <th style={{ padding: '12px', textAlign: 'center', width: '60px' }}>Avatar</th>
              <th style={{ padding: '12px', textAlign: 'left', width: '80px' }}>Car #</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Den</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Heats</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>{scoreLabel}</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry: LeaderboardEntry, index: number) => (
              <tr
                key={entry.racerId}
                style={{
                  ...getRankStyle(entry.rank),
                  borderBottom: index < leaderboard.length - 1 ? '1px solid #eee' : 'none'
                }}
              >
                <td style={{ padding: '12px', fontSize: '1.1rem' }}>
                  {getRankMedal(entry.rank)} {entry.rank}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <RacerAvatar
                    racer={{
                      id: entry.racerId,
                      first_name: entry.firstName,
                      last_name: entry.lastName,
                      racer_image_url: entry.racerImageUrl
                    }}
                    size="40px"
                  />
                </td>
                <td style={{ padding: '12px', fontWeight: 'bold' }}>
                  {entry.carNumber}
                </td>
                <td style={{ padding: '12px' }}>
                  {entry.firstName} {entry.lastName}
                </td>
                <td style={{ padding: '12px', color: '#666' }}>
                  {entry.denName}
                </td>
                <td style={{ padding: '12px', textAlign: 'center', color: '#666' }}>
                  {entry.heatsCompleted}
                </td>
                <td style={{
                  padding: '12px',
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontSize: '1.05rem',
                  fontWeight: entry.rank <= 3 ? 'bold' : 'normal'
                }}>
                  {entry.heatsCompleted > 0
                    ? formatScore(entry.score, scoringStrategy)
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
        {scoringStrategy === 'TIMED'
          ? 'Lower average time is better'
          : 'Lower total points is better (1st place = 1 point, 2nd = 2 points, etc.)'
        }
      </div>
    </div>
  );
}
