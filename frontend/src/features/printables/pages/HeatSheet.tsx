/**
 * The running order on paper, for the announcer's table (#173).
 *
 * Its own page rather than another card in `Printables`: that page is a grid
 * of one card repeated, sized in inches, and this is a table per round. The
 * two share the print stylesheet and nothing else.
 *
 * There is a **Result** column with nothing in it, deliberately. This sheet
 * exists for the moment the network drops or the laptop goes flat, and what
 * somebody does then is write the finishing order in the margin.
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiArrowLeft, mdiPrinter } from '@mdi/js';

import { buildHeatSheet, totalHeats, type SheetHeat, type SheetRacer } from '../heatSheet';
import { DerbyCar } from '../components/PrintDecor';
import { formatEventDate } from '../documents';
import { GET_HEAT_SHEET } from '../graphql/queries';
import { printablesThemeRootProps } from '../printablesTheme';
import '../PrintSheet.css';

export default function HeatSheet() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;

    const [{ data, fetching, error }] = useQuery({
        query: GET_HEAT_SHEET,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const race = data?.race;

    const sections = useMemo(() => {
        if (!race) return [];
        const track = data?.tracks?.find(
            (t: { id: number }) => t.id === race.trackId,
        );
        // Every lane the track has. A lane out of service has no column, and
        // that comes from the schedule rather than from here — a heat simply
        // has no lane there, and `buildHeatSheet` fills the gap.
        const laneCount: number = track?.laneCount ?? 4;
        const lanes = Array.from({ length: laneCount }, (_, i) => i + 1);
        return buildHeatSheet(
            race.rounds ?? [],
            (race.heats ?? []) as SheetHeat[],
            (race.racers ?? []) as SheetRacer[],
            lanes,
        );
    }, [race, data]);

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    const heats = totalHeats(sections);
    const laneColumns = sections[0]?.rows[0]?.cells ?? [];

    return (
        <div className="printables-page" {...printablesThemeRootProps(data?.initialConfig?.printablesTheme)}>
            <div className="printables-controls no-print">
                <div>
                    <Link
                        to={`/race/${parsedRaceId}/control`}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--print-primary-color)',
                            fontSize: '0.85rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <Icon path={mdiArrowLeft} size={0.7} /> Back to race control
                    </Link>
                    <h2 style={{ margin: 0 }}>Heat sheet</h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="printables-summary">
                        {heats} {heats === 1 ? 'heat' : 'heats'} ·{' '}
                        {sections.length} {sections.length === 1 ? 'round' : 'rounds'}
                    </span>
                    <button
                        className="primary-btn"
                        onClick={() => window.print()}
                        disabled={heats === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Icon path={mdiPrinter} size={0.8} /> Print
                    </button>
                </div>
            </div>

            {heats === 0 ? (
                <p className="no-print">
                    No heats scheduled yet. Generate a round on Race Control first.
                </p>
            ) : (
                <div className="heat-sheet">
                    <header className="heat-sheet-header">
                        {/* The same car that rides the pit passes, so a sheet
                            on the announcer's table and a pass round a scout's
                            neck read as one event. */}
                        <DerbyCar size={54} className="heat-sheet-mark" color="var(--print-surface-color)" />
                        <div>
                        <h1>{race.name}</h1>
                        <p>
                            {formatEventDate(race.dateTime)}
                            {race.location ? ` · ${race.location}` : ''}
                        </p>
                        </div>
                    </header>

                    {sections.map((section) => (
                        <section key={section.roundId} className="heat-sheet-round">
                            <h2>{section.title}</h2>
                            <table>
                                <thead>
                                    <tr>
                                        <th className="heat-sheet-num">Heat</th>
                                        {laneColumns.map((cell) => (
                                            <th key={cell.lane}>Lane {cell.lane}</th>
                                        ))}
                                        <th className="heat-sheet-result">Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {section.rows.map((row) => (
                                        <tr key={row.heatId}>
                                            <td className="heat-sheet-num">{row.heatNumber}</td>
                                            {row.cells.map((cell) => (
                                                <td key={cell.lane}>
                                                    {cell.carNumber && (
                                                        <span className="heat-sheet-car">
                                                            #{cell.carNumber}
                                                        </span>
                                                    )}{' '}
                                                    {cell.name}
                                                </td>
                                            ))}
                                            <td className="heat-sheet-result" />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
