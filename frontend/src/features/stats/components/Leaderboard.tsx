import { useState } from 'react';
import { useQuery, useSubscription } from 'urql';
import { LeaderboardSubscription } from '../../observation/graphql/queries';
import RacerAvatar from '../../management/components/RacerAvatar';
import { RoundSummary, exclusionNotice, roundLabel } from '../disruptedRounds';
import { standingsRows, standingsSuffix } from '../standingsExport';
import { slowestFirst } from '../slowestFirst';
import { Link } from 'react-router-dom';
import { downloadCsv, filenameFor } from '../../../utils/csv';
import { rankLabel } from '../../management/rankText';

export interface LeaderboardEntry {
  racerId: number;
  firstName: string;
  lastName: string;
  carNumber: number;
  denName: string;
  denRank?: string | null;
  score: number;
  heatsCompleted: number;
  rank: number;
  racerImageUrl?: string;
}

const GET_LEADERBOARD_METADATA = `
  query GetLeaderboardMetadata($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      scoringStrategy
      rounds {
        id
        name
        roundNumber
        advancementSource
        advancementFromBottom
        schedulingStrategy
        eliminationLosses
        disrupted
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
        denRank
        score
        heatsCompleted
        rank
        racerImageUrl
      }
    }
  }
`;

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
  // Rounds with standings of their own: championship rounds, and elimination
  // rounds, whose result is survival rather than a share of the aggregate.
  const selectableRounds = rounds.filter(
    (r) => r.advancementSource || r.schedulingStrategy === 'ELIMINATION'
  );

  const fetched = (
    selectedRoundId === null
      ? subscriptionData?.leaderboard || []
      : roundResult.data?.race?.leaderboard || []
  ) as LeaderboardEntry[];

  // A Slowest Race round is read the way the room reads it: the last car
  // down the track wins, so the slowest recorded car is rank 1. Display
  // only — the stored standings stay lower-is-better.
  const selectedRound =
    selectedRoundId === null ? null : rounds.find((r) => r.id === selectedRoundId) ?? null;
  const leaderboard = selectedRound?.advancementFromBottom ? slowestFirst(fetched) : fetched;

  const scoringStrategy = race?.scoringStrategy || 'TIMED';

  const hasResults = leaderboard.some((entry: LeaderboardEntry) => entry.heatsCompleted > 0);
  const stillLoading = queryFetching || roundResult.fetching;

  // A lane that went out of service part-way through a round takes that round
  // out of POINTS standings (#171). Worth saying wherever the standings are
  // shown, and *essential* in the empty state below: an operator whose only
  // prelim round was disrupted has completed every heat, so being told to
  // complete some would be a lie.
  const notice = exclusionNotice(rounds, scoringStrategy);

  // Empty overall standings only take over the whole page when there is
  // nothing else to offer. A race run entirely as an elimination round has
  // an empty aggregate *by design* — its heats are excluded — and hiding the
  // round selector here made the round's own standings unreachable.
  const nothingHere = leaderboard.length === 0 || !hasResults;
  if (!race || (nothingHere && !stillLoading && selectableRounds.length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', background: 'var(--surface-tint-color)', borderRadius: '8px' }}>
        <p>{notice ?? 'No results yet. Complete some heats to see standings!'}</p>
      </div>
    );
  }


  const isEliminationRound = selectedRound?.schedulingStrategy === 'ELIMINATION';
  const scoreLabel = isEliminationRound
    ? 'Losses'
    : scoringStrategy === 'TIMED' ? 'Avg Time' : 'Points';
  const formatScore = (score: number, strategy: string) => {
    if (isEliminationRound) {
      return `${Math.round(score)}`;
    }
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
      {notice && (
        <p
          role="status"
          style={{
            background: 'var(--warning-bg-color)',
            border: '1px solid var(--warning-notice-border-color)',
            borderRadius: '8px',
            padding: '0.6rem 0.9rem',
            fontSize: '0.9rem',
            color: 'var(--warning-notice-text-color)',
            marginBottom: '1rem',
          }}
        >
          {notice}
        </p>
      )}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '15px'
      }}>
        <h2 style={{ margin: 0 }}>
          {selectedRound === null ? 'Current Standings' : roundLabel(selectedRound)}
          {selectedRound?.advancementFromBottom && (
            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted-color)' }}>
              Slowest car first — the last one down the track wins.
            </span>
          )}
          {isEliminationRound && (
            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted-color)' }}>
              Lose {selectedRound?.eliminationLosses ?? 3} heats and you&apos;re
              out — the last car left wins.
            </span>
          )}
        </h2>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {selectableRounds.length > 0 && (
          <select
            aria-label="Standings scope"
            value={selectedRoundId ?? ''}
            onChange={(e) => setSelectedRoundId(e.target.value === '' ? null : parseInt(e.target.value))}
            style={{ padding: '8px 12px', borderRadius: '12px', border: '1px solid var(--input-border-color)' }}
          >
            <option value="">Overall (qualifying rounds)</option>
            {selectableRounds.map((r) => (
              <option key={r.id} value={r.id}>{roundLabel(r)}</option>
            ))}
          </select>
        )}

        {/* The standings never left the screen before (#173). Which standings
            these are travels in the filename, because the overall ones and a
            championship round's disagree on purpose (#17). */}
        <button
          type="button"
          className="secondary-btn"
          data-testid="export-standings"
          onClick={() =>
            downloadCsv(
              filenameFor(
                race?.name ?? 'race',
                standingsSuffix(
                  selectedRoundId === null
                    ? null
                    : roundLabel(rounds.find((r) => r.id === selectedRoundId)!),
                ),
              ),
              standingsRows(leaderboard, scoringStrategy),
            )
          }
          style={{ padding: '8px 14px', fontSize: '0.9rem' }}
        >
          Export CSV
        </button>

        {/* The paper version (#206). Beside the CSV rather than in the roster's
            print menu, because that menu prints the *cards* — one per racer,
            before the event — and this is one document about the whole race
            once it is over. */}
        <Link
          to={`/race/${raceId}/print/results`}
          className="secondary-btn"
          data-testid="print-results"
          style={{ padding: '8px 14px', fontSize: '0.9rem', textDecoration: 'none' }}
        >
          Print results
        </Link>
        </div>
      </div>

      {selectedRoundId === null && selectableRounds.length > 0 && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 14px',
          background: 'var(--info-notice-bg-color)',
          borderLeft: '4px solid var(--scouting-blue)',
          borderRadius: '12px',
          fontSize: '0.9rem',
          color: 'var(--text-heading-alt-color)'
        }}>
          Overall standings cover the qualifying rounds. Championship results are
          listed separately — pick a round above.
        </div>
      )}

      {nothingHere && !stillLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'var(--surface-tint-color)', borderRadius: '8px' }}>
          <p>{notice ?? 'No results yet for this view. Pick a round above, or complete some heats.'}</p>
        </div>
      ) : (
      <div style={{
        background: 'var(--surface-color)',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--scouting-blue)', color: 'var(--on-primary-color)' }}>
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
                  borderBottom: index < leaderboard.length - 1 ? '1px solid var(--divider-color)' : 'none'
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
                <td style={{ padding: '12px', color: 'var(--text-muted-color)' }}>
                  {entry.denName}
                  {entry.denRank && (
                    <span style={{ fontSize: '0.8rem' }}> ({rankLabel(entry.denRank)})</span>
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted-color)' }}>
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
      )}

      <div style={{
        marginTop: '10px',
        fontSize: '0.85rem',
        color: 'var(--text-muted-color)',
        textAlign: 'center'
      }}>
        {isEliminationRound
          ? 'A loss is any heat a car does not win. Cars still racing are listed first.'
          : selectedRound?.advancementFromBottom
          ? scoringStrategy === 'TIMED'
            ? 'Higher average time wins this round'
            : 'Higher total points win this round (1st place = 1 point, 2nd = 2 points, etc.)'
          : scoringStrategy === 'TIMED'
            ? 'Lower average time is better'
            : 'Lower total points is better (1st place = 1 point, 2nd = 2 points, etc.)'
        }
      </div>
    </div>
  );
}
