import { Fragment, useState } from 'react';
import { useQuery, useSubscription } from 'urql';
import { LeaderboardSubscription } from '../../observation/graphql/queries';
import RacerAvatar from '../../management/components/RacerAvatar';
import { RoundSummary, exclusionNotice, roundLabel } from '../disruptedRounds';
import { excludedCount, excludedNotice } from '../excludedFromStandings';
import { dropWorstNotice } from '../dropWorstNotice';
import { standingsRows, standingsSuffix } from '../standingsExport';
import { slowestFirst } from '../slowestFirst';
import { shouldShowDivision } from '../racingGroupLabel';
import { resolutionNote } from '../tiebreakText';
import { defaultEliminationRound, isEliminationOnlyRace } from '../eliminationScope';
import { dnfAnnotation, formatScore, scoreLabel } from '../scoringStrategyText';
import { Link, useSearchParams } from 'react-router-dom';
import { downloadCsv, filenameFor } from '../../../utils/csv';
import { useTerminology } from '../../../context/TerminologyContext';
import RunOffControl from '../../racing/components/RunOffControl';
import { runOffCluster, usableLaneCount } from '../../racing/runOff';

export interface LeaderboardEntry {
  racerId: number;
  firstName: string;
  lastName: string;
  carNumber: number;
  racingGroupName: string;
  racingGroupDivision?: string | null;
  score: number;
  heatsCompleted: number;
  /** How many of `heatsCompleted` were an actual DNF rather than a genuine
   * slow finish (#898). See `dnfAnnotation`. */
  dnfCount?: number;
  rank: number;
  racerImageUrl?: string;
  /** How a shared score was broken, or null if it was never tied or the tie
   * did not resolve (#540). See `resolutionNote`. */
  resolvedBy?: string | null;
  /** Whether `Race.dropWorstRuns` actually dropped a run from this row's
   * computation — the same value on every row (#547 stage 2). See
   * `dropWorstNotice`. */
  dropWorstRunsApplied?: boolean;
}

const GET_LEADERBOARD_METADATA = `
  query GetLeaderboardMetadata($raceId: Int!) {
    race(raceId: $raceId) {
      id
      name
      scoringStrategy
      # How many of each racer's worst runs are dropped before scoring
      # (drop-worst-runs, issue 547 stage 2) — read here so the "not
      # applied" notice can tell a configured-but-not-firing modifier
      # from one that is simply off.
      dropWorstRuns
      # Scopes RunOffControl's arm/record subscription (run-off heats) — a
      # run-off can still be created and manually timed with no track
      # configured, but nothing can be armed without one. laneCount and
      # laneOutages (lane outages, issue 171) are read here too, so
      # RunOffControl can disable "Start run-off" for a cluster wider than
      # the track's usable lanes rather than let the server's refusal be
      # the first the operator hears of it (issue 766).
      track {
        id
        laneCount
        laneOutages
      }
      resolvedNameDisplay
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
      racers {
        id
        excludedFromStandings
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
        racingGroupName
        racingGroupDivision
        score
        heatsCompleted
        dnfCount
        rank
        racerImageUrl
        resolvedBy
        dropWorstRunsApplied
      }
    }
  }
`;

interface LeaderboardProps {
  raceId: number;
}

export default function Leaderboard({ raceId }: LeaderboardProps) {
  const { group, vehicle, vehicles, vehicleLower, vehiclesLower } = useTerminology();
  const [searchParams, setSearchParams] = useSearchParams();
  // #1008: a reload or a shared link used to drop back to "Overall" no
  // matter which round was on screen. `?round=<id>` is the one source of
  // truth for the *initial* value — read once, here, rather than synced
  // back in an effect — and it beats every other default: the elimination
  // one just below only ever gets to run when the URL said nothing at all.
  const initialRoundParam = (() => {
    const raw = searchParams.get('round');
    if (raw === null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();
  // null means the overall standings, which cover preliminary rounds only.
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(initialRoundParam ?? null);
  // Whether the elimination-only default (below) has already had its one
  // chance to fire — set once rounds first arrive, so a later, deliberate
  // "Overall" pick by the operator is never overridden a second time. A
  // URL param already answered the same question, so it starts "already
  // applied" too — the URL wins over the default, and the default wins
  // over nothing.
  const [hasAppliedEliminationDefault, setHasAppliedEliminationDefault] = useState(
    initialRoundParam !== undefined,
  );

  // The one place a pick is made, on the select and (soon) the elimination
  // default alike — `replace: true` so choosing a round from the picker
  // does not leave a Back-button trail of every scope the operator glanced
  // at, only the page they arrived from and the one they are looking at now.
  const selectRound = (id: number | null) => {
    setSelectedRoundId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === null) next.delete('round');
        else next.set('round', String(id));
        return next;
      },
      { replace: true },
    );
  };

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

  // A race whose only round is elimination can never populate "Overall"
  // (#1020) — `services/scoring._scoring_heats` excludes elimination heats
  // from that aggregate by design, so it stays empty however completely the
  // race has been raced. Land the selector on the round that actually holds
  // the result instead, the one time rounds first arrive. This is an
  // "adjust state while rendering" comparison (see `RaceDetails.tsx`'s
  // `editParam` handling), not an effect: a `useEffect` calling `setState`
  // unconditionally on every render where the condition still holds would
  // fight an operator who deliberately switches back to "Overall" to
  // confirm it really is empty.
  const eliminationOnlyRace = isEliminationOnlyRace(rounds);
  if (!hasAppliedEliminationDefault && rounds.length > 0) {
    setHasAppliedEliminationDefault(true);
    if (eliminationOnlyRace && selectedRoundId === null) {
      const target = defaultEliminationRound(rounds);
      if (target) selectRound(target.id);
    }
  }
  // Null when the race has no track — matches `RunOffControl`'s own
  // `trackId` null convention, and its `tooManyForRunOff` treats an unknown
  // count as "don't disable" the same way (#766).
  const trackUsableLaneCount: number | null = race?.track
    ? usableLaneCount(race.track.laneCount, race.track.laneOutages ?? [])
    : null;
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

  // Said only while "Overall" is the view an elimination-only race is
  // showing — reachable once the default above has already put the
  // operator on the elimination round and they have switched back anyway.
  // "Complete some heats" would be false the moment the race has one, since
  // Overall stays empty for this race shape by design, not for lack of
  // racing.
  const eliminationOnlyOverallMessage =
    eliminationOnlyRace && selectedRoundId === null
      ? (() => {
          const target = defaultEliminationRound(rounds);
          return target
            ? `This race is scored by elimination — pick ${roundLabel(target)} above.`
            : null;
        })()
      : null;

  // "Racing, not ranked" (#548) — said out loud rather than shown as a
  // shorter list with no explanation, the same rule `notice` above follows
  // for a disrupted round.
  const excludedRacersNotice = excludedNotice(
    excludedCount((race?.racers || []) as { excludedFromStandings: boolean }[]),
    vehicleLower,
    vehiclesLower,
  );

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

  // "Drop the worst run" (#547 stage 2) is a modifier over the strategy, not
  // a strategy of its own — it can be configured and still drop nothing, if
  // the field is not yet even. `dropWorstRunsApplied` rides on every row, so
  // any one entry answers for the whole computation; there is nothing to say
  // while the view is empty. An elimination round's own standings never call
  // `score_heats` at all (its score is losses, not the chosen strategy), so
  // the modifier is never "not applied" there — it is simply a different
  // question, and the notice would be telling the operator about a
  // consequence that does not exist.
  const dropWorstMsg =
    nothingHere || isEliminationRound
      ? null
      : dropWorstNotice(race?.dropWorstRuns ?? 0, leaderboard[0]?.dropWorstRunsApplied ?? false);

  const scoreColumnLabel = isEliminationRound ? 'Losses' : scoreLabel(scoringStrategy);
  const formatScoreCell = (score: number, strategy: string) =>
    isEliminationRound ? `${Math.round(score)}` : formatScore(score, strategy);

  const getRankMedal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
  };

  // A discrete indicator, not a wash (#941) — the same rule `PrintDecor`
  // and the lane-colour work already follow. The old full-row fill put the
  // den and heats cells' muted text at ~2.2:1 (bronze) / ~2.5:1 (silver)
  // against WCAG AA's 4.5:1, and the three literals ignored the App theme
  // entirely. A 4px left accent on the Rank cell reads the podium at a
  // glance without touching any cell's text colour, and the three medal
  // colours are theme tokens (`index.css`, `theming/themes.ts`) rather than
  // literals, so the accent follows the App theme like everything else on
  // this screen. Every rank gets the same border width, transparent below
  // 3rd, so the Rank column's width never shifts between rows.
  const getRankAccentColor = (rank: number): string => {
    if (rank === 1) return 'var(--rank-gold-color)';
    if (rank === 2) return 'var(--rank-silver-icon-color)';
    if (rank === 3) return 'var(--rank-bronze-icon-color)';
    return 'transparent';
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
      {excludedRacersNotice && (
        <p
          role="status"
          data-testid="excluded-from-standings-notice"
          style={{
            background: 'var(--info-notice-bg-color)',
            border: '1px solid var(--scouting-blue)',
            borderRadius: '8px',
            padding: '0.6rem 0.9rem',
            fontSize: '0.9rem',
            color: 'var(--text-heading-alt-color)',
            marginBottom: '1rem',
          }}
        >
          {excludedRacersNotice}
        </p>
      )}
      {dropWorstMsg && (
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
          {dropWorstMsg}
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
              Slowest {vehicleLower} first — the last one down the track wins.
            </span>
          )}
          {isEliminationRound && (
            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted-color)' }}>
              Lose {selectedRound?.eliminationLosses ?? 3} heats and you&apos;re
              out — the last {vehicleLower} left wins.
            </span>
          )}
        </h2>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {selectableRounds.length > 0 && (
          <select
            aria-label="Standings scope"
            value={selectedRoundId ?? ''}
            onChange={(e) => selectRound(e.target.value === '' ? null : parseInt(e.target.value))}
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
              standingsRows(
                leaderboard,
                scoringStrategy,
                group,
                vehicle,
                race?.resolvedNameDisplay ?? 'FULL',
              ),
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

      {selectedRoundId === null && selectableRounds.length > 0 && !eliminationOnlyRace && (
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
          <p>{notice ?? eliminationOnlyOverallMessage ?? 'No results yet for this view. Pick a round above, or complete some heats.'}</p>
        </div>
      ) : (
      <div style={{
        background: 'var(--surface-color)',
        borderRadius: '8px',
        // A seven-column table is wider than a phone screen at its own
        // column widths, and `overflow: 'hidden'` used to crop the Heats
        // and score columns off entirely with nothing to reach them
        // (#950) — the same shape the schedule's own heat tables already
        // solve with a horizontal scroll container rather than a squeeze.
        // At desktop widths the table already fits, so this never shows a
        // scrollbar there.
        overflowX: 'auto',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--scouting-blue)', color: 'var(--on-primary-color)' }}>
              <th style={{ padding: '12px', textAlign: 'left', width: '60px' }}>Rank</th>
              <th style={{ padding: '12px', textAlign: 'center', width: '60px' }}>Avatar</th>
              <th style={{ padding: '12px', textAlign: 'left', width: '80px' }}>{vehicle} #</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>{group}</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Heats</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>{scoreColumnLabel}</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry: LeaderboardEntry, index: number) => {
              // A run-off control appears once per shared rank, under its
              // last row — computed here rather than carried by the
              // leaderboard itself, the same "derive it from what's on
              // screen" shape `resolutionNote` already uses (#550). Not
              // offered for an elimination round: its survival ranks never
              // go through the tiebreak chain a run-off resolves through.
              //
              // `runOffCluster` (#1017) is what keeps the control — and the
              // only record of a run-off's own times — on the row once it
              // has settled the tie: a resolved pair no longer shares a
              // rank, so the plain rank-based grouping alone would drop
              // them the moment the run-off did its job.
              const cluster = runOffCluster(leaderboard, index);
              const nextInCluster = leaderboard[index + 1];
              const isEndOfTiedCluster =
                cluster.length > 1 &&
                (!nextInCluster || !cluster.includes(nextInCluster));
              return (
                <Fragment key={entry.racerId}>
                  <tr
                    style={{
                      borderBottom: index < leaderboard.length - 1 ? '1px solid var(--divider-color)' : 'none'
                    }}
                  >
                <td
                  data-testid="leaderboard-rank-cell"
                  style={{
                    padding: '12px',
                    fontSize: '1.1rem',
                    borderLeft: `4px solid ${getRankAccentColor(entry.rank)}`,
                  }}
                >
                  {getRankMedal(entry.rank)} {entry.rank}
                  {/* A resolved tie stops sharing a rank and says why —
                      "2nd, on fastest single heat" — rather than silently
                      un-sharing it (#540). An unresolved tie shows nothing
                      extra, exactly as it always has. */}
                  {resolutionNote(entry.rank, entry.resolvedBy) && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.7rem',
                        fontWeight: 'normal',
                        color: 'var(--text-muted-color)',
                      }}
                    >
                      {resolutionNote(entry.rank, entry.resolvedBy)}
                    </span>
                  )}
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
                  {entry.racingGroupName}
                  {shouldShowDivision(entry.racingGroupName, entry.racingGroupDivision) && (
                    <span style={{ fontSize: '0.8rem' }}> ({entry.racingGroupDivision})</span>
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted-color)' }}>
                  {entry.heatsCompleted}
                </td>
                <td style={{
                  padding: '12px',
                  textAlign: 'right',
                  fontFamily: 'var(--font-body)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '1.05rem',
                  fontWeight: entry.rank <= 3 ? 'bold' : 'normal'
                }}>
                  {entry.heatsCompleted > 0
                    ? formatScoreCell(entry.score, scoringStrategy)
                    : '-'
                  }
                  {/* A neutral note beside the score, never a label
                      replacing it (#898) — the row still reports what the
                      car scored. Elimination rounds never carry a dnfCount
                      (survival is scored by loss count), so this is a
                      no-op there without needing its own guard. */}
                  {entry.heatsCompleted > 0 && dnfAnnotation(entry.dnfCount ?? 0, scoringStrategy) && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.75rem',
                        fontWeight: 'normal',
                        color: 'var(--text-muted-color)',
                      }}
                    >
                      {dnfAnnotation(entry.dnfCount ?? 0, scoringStrategy)}
                    </span>
                  )}
                </td>
                  </tr>
                  {isEndOfTiedCluster && !isEliminationRound && (
                    <tr style={{ borderBottom: index < leaderboard.length - 1 ? '1px solid var(--divider-color)' : 'none' }}>
                      <td colSpan={7} style={{ padding: '0 12px 10px' }}>
                        <RunOffControl
                          raceId={raceId}
                          trackId={race?.track?.id ?? null}
                          settlesRoundId={selectedRoundId}
                          racers={cluster.map((e) => ({
                            racerId: e.racerId,
                            name: `${e.firstName} ${e.lastName}`,
                          }))}
                          usableLaneCount={trackUsableLaneCount}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
          ? `A loss is any heat a ${vehicleLower} does not win. ${vehicles} still racing are listed first.`
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
