import { useState } from 'react';
import { downloadCsv, filenameFor, type CsvRow } from '../../../utils/csv';
import { useParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { GET_RACE_STATS } from '../graphql/queries';
import { useTerminology } from '../../../context/TerminologyContext';
import { formatScaleMph } from '../../observation/scaleSpeed';
import { groupScoreDomain } from '../groupScoreDomain';
import { strategyLabel } from '../scoringStrategyText';
import { hideRaceColumn } from '../trackRecordColumns';
import { useNarrowViewport } from '../../core/hooks/useNarrowViewport';
import './RaceStats.css';

// ---- Types ----

interface TimesPerLane {
  lane: number;
  avgTime: number | null;
}

interface RacerStat {
  racerId: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
  racingGroupName: string;
  heatsCompleted: number;
  heatsScheduled: number;
  minTime: number | null;
  maxTime: number | null;
  meanTime: number | null;
  stdDev: number | null;
  timesPerLane: TimesPerLane[];
}

interface LaneTimeStat {
  lane: number;
  avgTime: number | null;
  heatCount: number;
  relativeAdvantagePct: number | null;
}

interface HeatHighlight {
  type: string;
  roundName: string;
  heatNumber: number;
  globalHeatNumber: number;
  racerName: string | null;
  time: number | null;
  margin: number | null;
}

interface RacingGroupStat {
  racingGroupId: number;
  racingGroupName: string;
  racingGroupColor: string;
  racerCount: number;
  avgScore: number | null;
  bestRacerName: string | null;
}

interface HeatResultRow {
  roundName: string;
  heatNumber: number;
  globalHeatNumber: number;
  lane: number;
  carNumber: number | null;
  racerFirstName: string;
  racerLastName: string;
  time: number | null;
  place: number | null;
}

interface TrackRecord {
  timeSeconds: number;
  racerName: string;
  carNumber: number | null;
  /** Null for a historical record entered by hand — no race backs it. */
  raceId: number | null;
  raceName: string | null;
  raceDate: string | null;
}

interface RaceStatsData {
  raceId: number;
  raceName: string;
  scoringStrategy: string;
  totalHeatsScheduled: number;
  totalHeatsCompleted: number;
  totalRacers: number;
  laneStats: LaneTimeStat[];
  racerStats: RacerStat[];
  highlights: HeatHighlight[];
  racingGroupStats: RacingGroupStat[];
  heatResults: HeatResultRow[];
  trackRecords: TrackRecord[];
  topScaleMph: number | null;
}

/** "Mar 14, 2026" from the race's stored date, or nothing if it has none. */
function recordDate(raceDate: string | null): string | null {
  if (!raceDate) return null;
  // A bare date (how a historical record stores one) parses as UTC midnight,
  // which toLocaleDateString renders as the previous day anywhere west of
  // Greenwich. Pin it to local midnight instead.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raceDate) ? `${raceDate}T00:00:00` : raceDate);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---- CSV helpers ----

function exportHeatResults(heatResults: HeatResultRow[], raceName: string, vehicleWord = 'Car') {
  const header: CsvRow = ['Round', 'Heat #', 'Global Heat #', 'Lane', `${vehicleWord} #`, 'First Name', 'Last Name', 'Time (s)', 'Place'];
  const rows = heatResults.map(r => [
    r.roundName,
    r.heatNumber,
    r.globalHeatNumber,
    r.lane,
    r.carNumber,
    r.racerFirstName,
    r.racerLastName,
    r.time,
    r.place,
  ] as CsvRow);
  downloadCsv(filenameFor(raceName, 'heat-results'), [header, ...rows]);
}

function exportRacerStats(racerStats: RacerStat[], raceName: string, groupWord = 'Den', vehicleWord = 'Car') {
  const header: CsvRow = [`${vehicleWord} #`, 'First Name', 'Last Name', groupWord, 'Heats', 'Min (s)', 'Avg (s)', 'Max (s)', 'Std Dev'];
  const rows = racerStats.map(r => [
    r.carNumber,
    r.firstName,
    r.lastName,
    r.racingGroupName,
    r.heatsCompleted,
    r.minTime,
    r.meanTime,
    r.maxTime,
    r.stdDev,
  ] as CsvRow);
  downloadCsv(filenameFor(raceName, 'racer-stats'), [header, ...rows]);
}

// ---- Sort helper ----

type SortKey = 'meanTime' | 'minTime' | 'maxTime' | 'stdDev' | 'heatsCompleted' | 'carNumber' | 'lastName';

function sortRacers(racers: RacerStat[], key: SortKey, dir: 'asc' | 'desc'): RacerStat[] {
  return [...racers].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = (va as number | string) < (vb as number | string) ? -1 : (va as number | string) > (vb as number | string) ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

const fmt = (t: number | null | undefined) =>
  t != null ? t.toFixed(3) + 's' : '—';

// ---- Component ----

export default function RaceStats() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');
  const { group, groups, vehicle, vehicleLower } = useTerminology();

  const [result, reExecute] = useQuery({
    query: GET_RACE_STATS,
    variables: { raceId: id },
    requestPolicy: 'cache-and-network',
    pause: !id || isNaN(id),
  });

  useRaceStateChanged(id, () => reExecute({ requestPolicy: 'network-only' }));

  const [sortKey, setSortKey] = useState<SortKey>('meanTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Recharts draws axis ticks itself, in JS, not CSS — a `@media` rule
  // cannot shorten "Lane 1" to "L1" or force `interval={0}` the way the
  // table columns below are hidden by a stylesheet (#1147).
  const isNarrow = useNarrowViewport(600);

  if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

  const { data, fetching, error } = result;
  const stats: RaceStatsData | null = data?.raceStats ?? null;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (fetching && !stats) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading stats...</div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'red' }}>Error loading stats</div>;
  }

  if (!stats) {
    return (
      <div className="container race-stats">
        <div className="race-stats__empty">
          <p>No stats available for this race yet.</p>
        </div>
      </div>
    );
  }

  const sortedRacers = sortRacers(stats.racerStats, sortKey, sortDir);
  const hasResults = stats.totalHeatsCompleted > 0;

  return (
    <div className="container race-stats" style={{ padding: '2rem' }}>
      {/* Overview Cards */}
      <div className="race-stats__overview-cards">
        <div className="race-stats__overview-card race-stats__overview-card--badge">
          <div className="race-stats__overview-card-label">Scoring</div>
          <div className="race-stats__overview-card-value">{strategyLabel(stats.scoringStrategy)}</div>
        </div>
        <div className="race-stats__overview-card">
          <div className="race-stats__overview-card-label">Racers</div>
          <div className="race-stats__overview-card-value">
            {stats.racerStats.length} / {stats.totalRacers}
          </div>
        </div>
        <div className="race-stats__overview-card">
          <div className="race-stats__overview-card-label">Heats Completed</div>
          <div className="race-stats__overview-card-value">
            {stats.totalHeatsCompleted} / {stats.totalHeatsScheduled}
          </div>
        </div>
      </div>

      {!hasResults && (
        <div className="race-stats__empty">
          <p>No heat results recorded yet. Complete some heats to see statistics.</p>
        </div>
      )}

      {hasResults && (
        <>
          {/* Lane Fairness */}
          <div className="race-stats__section">
            <h2 className="race-stats__section-title">Lane Fairness</h2>
            <div className="race-stats__chart-wrapper">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.laneStats} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  {/* `interval={0}` forces every lane to get its own tick —
                      Recharts' default skips alternate labels once they
                      would collide, which at phone width turned a 4-lane
                      chart into "Lane 2 · Lane 4" with lanes 1 and 3
                      unlabelled (#1147). Short "L1"–"L4" labels under 600px
                      are what make room for all of them at that width;
                      `fontSize: 11` gives them a little more still. */}
                  <XAxis
                    dataKey="lane"
                    interval={0}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => (isNarrow ? `L${v}` : `Lane ${v}`)}
                  />
                  <YAxis unit="%" tickFormatter={(v: number) => v.toFixed(1)} />
                  <Tooltip
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'Advantage']}
                    labelFormatter={(label: unknown) => `Lane ${label}`}
                  />
                  <ReferenceLine y={0} stroke="var(--text-muted-color)" />
                  <Bar dataKey="relativeAdvantagePct" name="Advantage %">
                    {stats.laneStats.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={(entry.relativeAdvantagePct ?? 0) >= 0 ? 'var(--scouting-blue)' : 'var(--cub-scouting-gold)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="race-stats__table">
              <thead>
                <tr>
                  <th>Lane</th>
                  <th>Avg Time</th>
                  <th>Heats Run</th>
                  <th>Advantage %</th>
                </tr>
              </thead>
              <tbody>
                {stats.laneStats.map(ls => (
                  <tr key={ls.lane}>
                    {/* "Lane / 1" used to wrap onto two lines in a narrow
                        column (#1147) — the label is short but not
                        unbreakable at the space between the two words. */}
                    <td style={{ whiteSpace: 'nowrap' }}>Lane {ls.lane}</td>
                    <td className="mono">{fmt(ls.avgTime)}</td>
                    <td>{ls.heatCount}</td>
                    <td className="mono">
                      {ls.relativeAdvantagePct != null
                        ? `${ls.relativeAdvantagePct >= 0 ? '+' : ''}${ls.relativeAdvantagePct.toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-Racer Stats */}
          <div className="race-stats__section">
            <h2 className="race-stats__section-title">
              Per-Racer Stats
              {stats.racerStats.length !== stats.totalRacers && (
                <span className="race-stats__section-subtitle">
                  ({stats.racerStats.length} of {stats.totalRacers} have raced)
                </span>
              )}
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="race-stats__table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('carNumber')}>
                      #{sortIndicator('carNumber')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('lastName')}>
                      Name{sortIndicator('lastName')}
                    </th>
                    <th className="rs-col-group">{group}</th>
                    <th className="sortable" onClick={() => handleSort('heatsCompleted')}>
                      Heats{sortIndicator('heatsCompleted')}
                    </th>
                    <th className="rs-col-min sortable" onClick={() => handleSort('minTime')}>
                      Min{sortIndicator('minTime')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('meanTime')}>
                      Avg{sortIndicator('meanTime')}
                    </th>
                    <th className="rs-col-max sortable" onClick={() => handleSort('maxTime')}>
                      Max{sortIndicator('maxTime')}
                    </th>
                    <th className="rs-col-stddev sortable" onClick={() => handleSort('stdDev')}>
                      Std Dev{sortIndicator('stdDev')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRacers.map(rs => (
                    <tr key={rs.racerId}>
                      <td>{rs.carNumber ?? '—'}</td>
                      <td>
                        {rs.firstName} {rs.lastName}
                        {/* Under 600px, {group}/Min/Max/Std Dev stop being
                            columns of their own — the table was 534px wide
                            with Avg and Max off-screen (#1147) — and Min/Max
                            reappear here as one muted line under the name.
                            {group} and Std Dev are dropped outright, the
                            same "least useful, not shown elsewhere" call
                            the issue made for Min alone as a column. */}
                        <span className="rs-mobile-meta">
                          Min {fmt(rs.minTime)} · Max {fmt(rs.maxTime)}
                        </span>
                      </td>
                      <td className="rs-col-group" style={{ color: 'var(--text-muted-color)' }}>{rs.racingGroupName}</td>
                      <td style={{ textAlign: 'center' }}>{rs.heatsCompleted}</td>
                      <td className="rs-col-min mono">{fmt(rs.minTime)}</td>
                      <td className="mono" style={{ fontWeight: 'bold' }}>{fmt(rs.meanTime)}</td>
                      <td className="rs-col-max mono">{fmt(rs.maxTime)}</td>
                      <td className="rs-col-stddev mono">{rs.stdDev != null ? rs.stdDev.toFixed(3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Moments */}
          {stats.highlights.length > 0 && (
            <div className="race-stats__section">
              <h2 className="race-stats__section-title">Top Moments</h2>
              <div className="race-stats__highlights">
                {stats.highlights.map((hl, i) => (
                  <div
                    key={i}
                    className={`race-stats__highlight-card${hl.type === 'CLOSEST_RACE' ? ' race-stats__highlight-card--closest' : ''}`}
                  >
                    <div className="race-stats__highlight-type">
                      {hl.type === 'FASTEST_HEAT' ? 'Fastest Heat' : 'Closest Race'}
                    </div>
                    <div className="race-stats__highlight-value">
                      {hl.type === 'FASTEST_HEAT' && hl.time != null
                        ? hl.time.toFixed(3) + 's'
                        : hl.margin != null
                          ? `Δ ${hl.margin.toFixed(3)}s`
                          : '—'}
                    </div>
                    {hl.type === 'FASTEST_HEAT' && formatScaleMph(stats.topScaleMph) && (
                      <div className="race-stats__highlight-scale-mph">
                        Top scale speed: {formatScaleMph(stats.topScaleMph)}
                      </div>
                    )}
                    <div className="race-stats__highlight-sub">
                      {hl.type === 'FASTEST_HEAT' && hl.racerName && (
                        <span>{hl.racerName} &mdash; </span>
                      )}
                      {hl.roundName}, Heat {hl.globalHeatNumber ?? hl.heatNumber}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Track Record — the fastest cars this track has ever seen,
              across every race run on it. Absent when the race has no track
              or nothing has been recorded on it yet. */}
          {stats.trackRecords.length > 0 && (
            <div className="race-stats__section" data-testid="track-record-section">
              <h2 className="race-stats__section-title">Track Record</h2>
              <div className="race-stats__highlights">
                <div className="race-stats__highlight-card race-stats__highlight-card--record">
                  <div className="race-stats__highlight-type">
                    Track Record
                    {stats.trackRecords[0].raceId === stats.raceId && (
                      <span className="race-stats__record-badge">Set at this event!</span>
                    )}
                  </div>
                  <div className="race-stats__highlight-value">
                    {stats.trackRecords[0].timeSeconds.toFixed(3)}s
                  </div>
                  <div className="race-stats__highlight-sub">
                    {stats.trackRecords[0].racerName}
                    {stats.trackRecords[0].carNumber != null && (
                      <span> ({vehicle} #{stats.trackRecords[0].carNumber})</span>
                    )}
                    {stats.trackRecords[0].raceName && (
                      <span> — {stats.trackRecords[0].raceName}</span>
                    )}
                    {recordDate(stats.trackRecords[0].raceDate) && (
                      <span>, {recordDate(stats.trackRecords[0].raceDate)}</span>
                    )}
                  </div>
                </div>
              </div>
              {stats.trackRecords.length > 1 && (() => {
                  // #1147: each row used to be ~90px tall, mostly from a
                  // "Race" column wrapping a name like "2026 Pinewood
                  // Derby, Sep 19, 2026" across up to four lines — while
                  // every row *also* carried a "THIS EVENT" badge under the
                  // racer, naming the same race twice. The standalone
                  // column is gone unconditionally now; when every record
                  // on the list is this race, the badge already says so on
                  // every row and nothing replaces it. Otherwise (a mix of
                  // this race and an earlier one, or a hand-entered
                  // historical record) the race name moves to one muted
                  // line under the racer's own name instead of a column
                  // that has to compete with Time/Racer/Car # for width.
                  const hideRace = hideRaceColumn(stats.trackRecords, stats.raceId);
                  return (
                  <table className="race-stats__table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Time</th>
                        <th>Racer</th>
                        <th>{vehicle} #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.trackRecords.map((tr, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td className="mono" style={{ fontWeight: i === 0 ? 'bold' : undefined }}>
                            {tr.timeSeconds.toFixed(3)}s
                          </td>
                          <td>
                            {tr.racerName}
                            {tr.raceId === stats.raceId && (
                              <span className="race-stats__record-badge">This event</span>
                            )}
                            {!hideRace && (
                              <span className="race-stats__record-race-meta">
                                {tr.raceName ?? '—'}
                                {recordDate(tr.raceDate) && `, ${recordDate(tr.raceDate)}`}
                              </span>
                            )}
                          </td>
                          <td>{tr.carNumber ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  );
              })()}
              <p className="race-stats__record-note">
                The fastest run each {vehicleLower} has recorded on this track, across
                every race run on it. Correcting a time moves the record;
                deleting a race removes the records it set.
              </p>
            </div>
          )}

          {/* Racing Group Comparison */}
          {stats.racingGroupStats.length > 0 && (
            <div className="race-stats__section">
              <h2 className="race-stats__section-title">{groups} Comparison</h2>
              <div className="race-stats__chart-wrapper">
                <ResponsiveContainer width="100%" height={Math.max(120, stats.racingGroupStats.length * 50)}>
                  <BarChart
                    data={stats.racingGroupStats}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    {/* Same fix as Lane Fairness's XAxis above (#1147):
                        Recharts' default `interval` skips a tick rather
                        than let two labels collide, which at phone width
                        left this chart down to two den names on screen. */}
                    <XAxis
                      type="number"
                      unit="s"
                      interval={0}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => v.toFixed(2)}
                      domain={groupScoreDomain(stats.racingGroupStats)}
                    />
                    <YAxis
                      type="category"
                      dataKey="racingGroupName"
                      width={75}
                      interval={0}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value: unknown) => [`${Number(value).toFixed(3)}s`, 'Avg Score']}
                    />
                    <Bar dataKey="avgScore" name="Avg Score">
                      {stats.racingGroupStats.map((entry, i) => (
                        <Cell key={i} fill={entry.racingGroupColor || 'var(--scouting-blue)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="race-stats__table">
                <thead>
                  <tr>
                    <th>{group}</th>
                    <th>Racers</th>
                    <th>Avg Score</th>
                    <th>Best Racer</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.racingGroupStats.map(ds => (
                    <tr key={ds.racingGroupId}>
                      <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            borderRadius: '3px',
                            backgroundColor: ds.racingGroupColor,
                            flexShrink: 0,
                          }}
                        />
                        {ds.racingGroupName}
                      </td>
                      <td>{ds.racerCount}</td>
                      <td className="mono">{fmt(ds.avgScore)}</td>
                      <td>{ds.bestRacerName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Export */}
          <div className="race-stats__section">
            <h2 className="race-stats__section-title">Export</h2>
            <div className="race-stats__export-buttons">
              <button
                className="race-stats__export-btn"
                onClick={() => exportHeatResults(stats.heatResults, stats.raceName, vehicle)}
              >
                Export Heat Results
              </button>
              <button
                className="race-stats__export-btn"
                onClick={() => exportRacerStats(stats.racerStats, stats.raceName, group, vehicle)}
              >
                Export Racer Stats
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
