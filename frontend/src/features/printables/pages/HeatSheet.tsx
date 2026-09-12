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

import {
    MASTER_RUNNING_ORDER_TITLE,
    buildHeatSheet,
    printedSummary,
    type SheetHeat,
    type SheetRacer,
    type SheetRunOffHeat,
} from '../heatSheet';
import { VehicleGlyph } from '../components/PrintDecor';
import { formatEventDate } from '../documents';
import { GET_HEAT_SHEET } from '../graphql/queries';
import { printablesThemeRootProps } from '../printablesTheme';
import { useTerminology } from '../../../context/TerminologyContext';
import LaneBadge from '../../../components/ui/LaneBadge';
import { colorForLane } from '../../settings/laneColors';
import { laneColumnCount } from '../../racing/lanes';
import '../PrintSheet.css';

export default function HeatSheet() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;
    const { vehicleArtworkKey } = useTerminology();

    const [{ data, fetching, error }] = useQuery({
        query: GET_HEAT_SHEET,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const race = data?.race;
    const track = useMemo(
        () => data?.tracks?.find((t: { id: number }) => t.id === race?.trackId),
        [data, race],
    );
    // This track's configured lane colours (#611) — a swatch beside each
    // lane's header, alongside the lane number rather than replacing it: a
    // mono printer renders every hue as a similar grey, and the number is
    // what still says which physical lane this column is on paper.
    const laneColors: readonly string[] = track?.laneColors ?? [];
    const laneCount: number = track?.laneCount ?? 4;

    const sections = useMemo(() => {
        if (!race) return [];
        // Every lane the track has, at minimum. A lane out of service still
        // gets a column — that comes from the schedule rather than from
        // here, a heat simply has no lane there, and `buildHeatSheet` fills
        // the gap — and a track shrunk after a race finished (#994) still
        // needs one for whatever lane that race's own heats hold: #325
        // rewrites *pending* heats to the smaller count, deliberately
        // leaving a recorded heat's lanes alone, and this sheet must not
        // silently drop the last one printed.
        const allLanes: { lanes: readonly { lane: number }[] }[] = [
            ...(race.heats ?? []),
            ...(race.runOffHeats ?? []),
        ];
        const columnCount = laneColumnCount(laneCount, allLanes);
        const lanes = Array.from({ length: columnCount }, (_, i) => i + 1);
        return buildHeatSheet(
            race.rounds ?? [],
            (race.heats ?? []) as SheetHeat[],
            (race.racers ?? []) as SheetRacer[],
            lanes,
            race.resolvedNameDisplay ?? 'FULL',
            // Master running order (#549) and run-off heats (#550) — #890:
            // the printed sheet used to ignore both, so it disagreed with
            // what the operator's Race tab and the wall displays actually
            // execute.
            !!race.masterRunningOrder,
            (race.runOffHeats ?? []) as SheetRunOffHeat[],
        );
    }, [race, laneCount]);

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    // A section is not a heat and not a round in one-to-one lockstep with
    // `sections` itself once the master running order's own flat section
    // (a duplicate of every non-championship heat, prepended ahead of the
    // per-round tables) or a run-off's one-row section is in the mix
    // (#1024) — `printedSummary` knows which of the three each section is.
    const { heats, rounds } = printedSummary(sections);
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
                        {rounds} {rounds === 1 ? 'round' : 'rounds'}
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
                        <VehicleGlyph artworkKey={vehicleArtworkKey} size={54} className="heat-sheet-mark" color="var(--print-surface-color)" />
                        <div>
                        <h1>{race.name}</h1>
                        <p>
                            {formatEventDate(race.dateTime)}
                            {race.location ? ` · ${race.location}` : ''}
                        </p>
                        </div>
                    </header>

                    {sections.map((section) => {
                        // The flat master-running-order section (#890) is
                        // the one place a row's round is not already said by
                        // the section heading, so it alone gets a Round
                        // column — reusing `runOffTitle`'s `heatNumber: 0`
                        // sentinel would be a number on paper worth nothing,
                        // so a run-off's own row leaves that cell blank too.
                        const isMasterOrder = section.title === MASTER_RUNNING_ORDER_TITLE;
                        return (
                        <section key={section.roundId} className="heat-sheet-round">
                            <h2>{section.title}</h2>
                            <table>
                                <thead>
                                    <tr>
                                        <th className="heat-sheet-num">Heat</th>
                                        {isMasterOrder && <th>Round</th>}
                                        {laneColumns.map((cell) => {
                                            // A column past the track's own
                                            // lane count is a finished
                                            // race's lane left over from
                                            // before the track was shrunk
                                            // (#994) — visible text, not a
                                            // hover title, since this page
                                            // is meant to be printed.
                                            const offTrack = cell.lane > laneCount;
                                            return (
                                                <th key={cell.lane}>
                                                    <LaneBadge color={colorForLane(laneColors, cell.lane)} style={{ justifyContent: 'center' }}>
                                                        Lane {cell.lane}
                                                    </LaneBadge>
                                                    {offTrack && (
                                                        <div style={{ fontWeight: 'normal', fontSize: '0.65em' }}>
                                                            not on this track
                                                        </div>
                                                    )}
                                                </th>
                                            );
                                        })}
                                        <th className="heat-sheet-result">Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {section.rows.map((row) => (
                                        <tr key={row.heatId}>
                                            <td className="heat-sheet-num">{row.heatNumber || ''}</td>
                                            {isMasterOrder && <td>{row.roundLabel}</td>}
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
                        );
                    })}
                </div>
            )}
        </div>
    );
}
