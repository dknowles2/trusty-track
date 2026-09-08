/**
 * The results on paper, once the racing is over (#206).
 *
 * Companion to the award ceremony: that puts the trophies on a projector, this
 * puts them and the placings on the noticeboard and in the newsletter. The
 * heat sheet is the other half — that one is printed before the racing, with a
 * blank Result column.
 *
 * Its own page rather than a card in `Printables`, for the same reason the heat
 * sheet is: that page is a grid of one card repeated and sized in inches, and
 * this is a document with sections. They share the print stylesheet.
 */

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiArrowLeft, mdiPrinter } from '@mdi/js';

import { VehicleGlyph } from '../components/PrintDecor';
import { formatEventDate } from '../documents';
import { championshipResultsQuery, GET_RESULTS_SHEET } from '../graphql/queries';
import type { SheetRound } from '../heatSheet';
import {
    awardLines,
    championshipSections,
    hasResults,
    OVERALL,
    resultsSections,
    type ChampionshipRoundResult,
    type ResultsAward,
    type ResultsEntry,
} from '../resultsSheet';
import { excludedCount, excludedNotice } from '../../stats/excludedFromStandings';
import { scoreHeading } from '../../stats/standingsExport';
import { printablesThemeRootProps } from '../printablesTheme';
import { useTerminology } from '../../../context/TerminologyContext';
import '../PrintSheet.css';

// A harmless, always-valid document for the championship-results query while
// it is paused (no championship round exists yet) — urql still needs a
// parseable `query`, even one that never runs.
const NOOP_QUERY = 'query Noop { __typename }';

export default function ResultsSheet() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;
    const { group, groupLower, vehicle, vehicleArtworkKey, vehicleLower, vehiclesLower } = useTerminology();

    const [{ data, fetching, error }] = useQuery({
        query: GET_RESULTS_SHEET,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const race = data?.race;
    const scoringStrategy: string = race?.scoringStrategy ?? 'TIMED';
    // How much of a racer's name this sheet prints (#552), resolved server-side.
    const nameDisplay = race?.resolvedNameDisplay ?? 'FULL';

    const sections = useMemo(
        () =>
            resultsSections(
                (race?.leaderboard ?? []) as ResultsEntry[],
                scoringStrategy,
                `No ${groupLower}`,
                nameDisplay,
            ),
        [race?.leaderboard, scoringStrategy, groupLower, nameDisplay],
    );
    const awards = useMemo(
        () => awardLines((race?.awards ?? []) as ResultsAward[], nameDisplay),
        [race?.awards, nameDisplay],
    );

    // The championship result (#869) — standings are prelim-scoped by
    // design (#17), so the round that actually decides the race never
    // reaches `resultsSections` above. A round's placings live behind
    // `leaderboard(roundId:)`, a query scope `GET_RESULTS_SHEET` cannot
    // express until the championship round's own id is known, so this is a
    // second, dynamically-built query — see `championshipResultsQuery`.
    const championshipRounds = useMemo(
        () => ((race?.rounds ?? []) as SheetRound[]).filter((round) => round.advancementSource != null),
        [race?.rounds],
    );
    const championshipRoundIds = useMemo(
        () => championshipRounds.map((round) => round.id),
        [championshipRounds],
    );
    const championshipQuery = useMemo(
        () => (championshipRoundIds.length > 0 ? championshipResultsQuery(championshipRoundIds) : NOOP_QUERY),
        [championshipRoundIds],
    );
    const [{ data: championshipData }] = useQuery({
        query: championshipQuery,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId || championshipRoundIds.length === 0,
    });
    const championshipResults: ChampionshipRoundResult[] = useMemo(
        () =>
            championshipRounds.map((round) => ({
                round,
                entries: (championshipData?.race?.[`round${round.id}`] ?? []) as ResultsEntry[],
            })),
        [championshipRounds, championshipData],
    );
    // Only a round that has actually been raced prints a table — see
    // `championshipSections`'s own docstring for why an unraced round with
    // nothing but placeholders is left out.
    const championshipTables = useMemo(
        () => championshipSections(championshipResults, scoringStrategy, nameDisplay),
        [championshipResults, scoringStrategy, nameDisplay],
    );
    // Printed before the per-den tables, right after the overall table —
    // the suggested order in #869, and what keeps the "qualifying rounds
    // only" note beside the thing it distinguishes itself from.
    const allSections = useMemo(
        () => (sections.length === 0 ? sections : [sections[0], ...championshipTables, ...sections.slice(1)]),
        [sections, championshipTables],
    );
    // "Racing, not ranked" (#548) — the sheet's half of the same rule the
    // Standings page follows: a flagged car needs to look flagged, even on
    // paper, rather than simply being a shorter list than the roster.
    const excludedRacersNotice = excludedNotice(
        excludedCount((race?.racers ?? []) as { excludedFromStandings: boolean }[]),
        vehicleLower,
        vehiclesLower,
    );

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    const anything = hasResults(sections, awards);
    const hasChampionshipTable = championshipTables.length > 0;

    return (
        <div className="printables-page" {...printablesThemeRootProps(data?.initialConfig?.printablesTheme)}>
            <div className="printables-controls no-print">
                <div>
                    <Link
                        to={`/race/${parsedRaceId}/standings`}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--print-primary-color)',
                            fontSize: '0.85rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <Icon path={mdiArrowLeft} size={0.7} /> Back to standings
                    </Link>
                    <h2 style={{ margin: 0 }}>Results sheet</h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="printables-summary">
                        {awards.length} {awards.length === 1 ? 'award' : 'awards'} ·{' '}
                        {allSections.length} {allSections.length === 1 ? 'table' : 'tables'}
                    </span>
                    <button
                        className="primary-btn"
                        onClick={() => window.print()}
                        disabled={!anything}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Icon path={mdiPrinter} size={0.8} /> Print
                    </button>
                </div>
            </div>

            {!anything ? (
                <p className="no-print">
                    Nothing to print yet. Run some heats, or add awards on the Awards tab.
                </p>
            ) : (
                <div className="heat-sheet" data-testid="results-sheet">
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

                    {excludedRacersNotice && (
                        <p className="results-note" data-testid="results-sheet-excluded-notice">
                            {excludedRacersNotice}
                        </p>
                    )}

                    {awards.length > 0 && (
                        <section className="heat-sheet-round">
                            <h2>Awards</h2>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Award</th>
                                        <th>Winner</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {awards.map((line) => (
                                        <tr key={line.id} data-testid={`award-line-${line.id}`}>
                                            <td>{line.name}</td>
                                            <td>{line.winner}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {allSections.map((section) => {
                        // The RacingGroup column says the same thing on every row of a
                        // racingGroup's own table, which is a column of noise on paper.
                        const isOverall = section.title === OVERALL;
                        return (
                        <section key={section.title} className="heat-sheet-round">
                            <h2>{section.title}</h2>
                            {/* Said once, on the table it applies to. The
                                standings are the qualifying rounds only (#17),
                                and a reader who does not know that will assume
                                the final is folded in. Now sits next to the
                                championship table itself when there is one
                                (#869), rather than pointing at an "awards
                                above" section that a race with no awards
                                defined never has. */}
                            {isOverall && (
                                <p className="results-note">
                                    {hasChampionshipTable
                                        ? 'Qualifying rounds only — the championship result is above.'
                                        : 'Qualifying rounds only.'}
                                </p>
                            )}
                            <table>
                                <thead>
                                    <tr>
                                        <th className="heat-sheet-num">Place</th>
                                        <th className="heat-sheet-num">{vehicle} #</th>
                                        <th>Racer</th>
                                        {isOverall && <th>{group}</th>}
                                        <th>{scoreHeading(scoringStrategy)}</th>
                                        <th className="heat-sheet-num">Heats</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {section.rows.map((row) => (
                                        <tr key={row.racerId}>
                                            <td className="heat-sheet-num">{row.place}</td>
                                            <td className="heat-sheet-num">{row.carNumber}</td>
                                            <td>{row.name}</td>
                                            {isOverall && <td>{row.racingGroupName}</td>}
                                            <td>{row.score}</td>
                                            <td className="heat-sheet-num">{row.heats}</td>
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
