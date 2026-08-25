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
  denName: string;
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

interface DenStat {
  denId: number;
  denName: string;
  denColor: string;
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
  denStats: DenStat[];
  heatResults: HeatResultRow[];
  trackRecords: TrackRecord[];
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

function exportHeatResults(heatResults: HeatResultRow[], raceName: string) {
  const header: CsvRow = ['Round', 'Heat #', 'Global Heat #', 'Lane', 'Car #', 'First Name', 'Last Name', 'Time (s)', 'Place'];
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

function exportRacerStats(racerStats: RacerStat[], raceName: string) {
  const header: CsvRow = ['Car #', 'First Name', 'Last Name', 'Den', 'Heats', 'Min (s)', 'Avg (s)', 'Max (s)', 'Std Dev'];
  const rows = racerStats.map(r => [
    r.carNumber,
    r.firstName,
    r.lastName,
    r.denName,
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

  const [result, reExecute] = useQuery({
    query: GET_RACE_STATS,
    variables: { raceId: id },
    requestPolicy: 'cache-and-network',
    pause: !id || isNaN(id),
  });

  useRaceStateChanged(id, () => reExecute({ requestPolicy: 'network-only' }));

  const [sortKey, setSortKey] = useState<SortKey>('meanTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
          <div className="race-stats__overview-card-value">{stats.scoringStrategy}</div>
        </div>
        <div className="race-stats__overview-card">
          <div className="race-stats__overview-card-label">Racers</div>
          <div className="race-stats__overview-card-value">{stats.totalRacers}</div>
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
                  <XAxis dataKey="lane" tickFormatter={(v: number) => `Lane ${v}`} />
                  <YAxis unit="%" tickFormatter={(v: number) => v.toFixed(1)} />
                  <Tooltip
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'Advantage']}
                    labelFormatter={(label: unknown) => `Lane ${label}`}
                  />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="relativeAdvantagePct" name="Advantage %">
                    {stats.laneStats.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={(entry.relativeAdvantagePct ?? 0) >= 0 ? '#003F87' : '#FCD116'}
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
                    <td>Lane {ls.lane}</td>
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
            <h2 className="race-stats__section-title">Per-Racer Stats</h2>
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
                    <th>Den</th>
                    <th className="sortable" onClick={() => handleSort('heatsCompleted')}>
                      Heats{sortIndicator('heatsCompleted')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('minTime')}>
                      Min{sortIndicator('minTime')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('meanTime')}>
                      Avg{sortIndicator('meanTime')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('maxTime')}>
                      Max{sortIndicator('maxTime')}
                    </th>
                    <th className="sortable" onClick={() => handleSort('stdDev')}>
                      Std Dev{sortIndicator('stdDev')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRacers.map(rs => (
                    <tr key={rs.racerId}>
                      <td>{rs.carNumber ?? '—'}</td>
                      <td>{rs.firstName} {rs.lastName}</td>
                      <td style={{ color: '#666' }}>{rs.denName}</td>
                      <td style={{ textAlign: 'center' }}>{rs.heatsCompleted}</td>
                      <td className="mono">{fmt(rs.minTime)}</td>
                      <td className="mono" style={{ fontWeight: 'bold' }}>{fmt(rs.meanTime)}</td>
                      <td className="mono">{fmt(rs.maxTime)}</td>
                      <td className="mono">{rs.stdDev != null ? rs.stdDev.toFixed(3) : '—'}</td>
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
                      <span> (Car #{stats.trackRecords[0].carNumber})</span>
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
              {stats.trackRecords.length > 1 && (
                  <table className="race-stats__table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Time</th>
                        <th>Racer</th>
                        <th>Car #</th>
                        <th>Race</th>
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
                          </td>
                          <td>{tr.carNumber ?? '—'}</td>
                          <td style={{ color: '#666' }}>
                            {tr.raceName ?? '—'}
                            {recordDate(tr.raceDate) && <span>, {recordDate(tr.raceDate)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              )}
              <p className="race-stats__record-note">
                The fastest run each car has recorded on this track, across
                every race run on it. Correcting a time moves the record;
                deleting a race removes the records it set.
              </p>
            </div>
          )}

          {/* Den Comparison */}
          {stats.denStats.length > 0 && (
            <div className="race-stats__section">
              <h2 className="race-stats__section-title">Den Comparison</h2>
              <div className="race-stats__chart-wrapper">
                <ResponsiveContainer width="100%" height={Math.max(120, stats.denStats.length * 50)}>
                  <BarChart
                    data={stats.denStats}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" unit="s" tickFormatter={(v: number) => v.toFixed(2)} />
                    <YAxis type="category" dataKey="denName" width={75} />
                    <Tooltip
                      formatter={(value: unknown) => [`${Number(value).toFixed(3)}s`, 'Avg Score']}
                    />
                    <Bar dataKey="avgScore" name="Avg Score">
                      {stats.denStats.map((entry, i) => (
                        <Cell key={i} fill={entry.denColor || '#003F87'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="race-stats__table">
                <thead>
                  <tr>
                    <th>Den</th>
                    <th>Racers</th>
                    <th>Avg Score</th>
                    <th>Best Racer</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.denStats.map(ds => (
                    <tr key={ds.denId}>
                      <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            borderRadius: '3px',
                            backgroundColor: ds.denColor,
                            flexShrink: 0,
                          }}
                        />
                        {ds.denName}
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
                onClick={() => exportHeatResults(stats.heatResults, stats.raceName)}
              >
                Export Heat Results
              </button>
              <button
                className="race-stats__export-btn"
                onClick={() => exportRacerStats(stats.racerStats, stats.raceName)}
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
