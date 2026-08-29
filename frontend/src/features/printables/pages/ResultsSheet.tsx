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

import { DerbyCar } from '../components/PrintDecor';
import { formatEventDate } from '../documents';
import { GET_RESULTS_SHEET } from '../graphql/queries';
import {
    awardLines,
    hasResults,
    OVERALL,
    resultsSections,
    type ResultsAward,
    type ResultsEntry,
} from '../resultsSheet';
import { scoreHeading } from '../../stats/standingsExport';
import { printablesThemeRootProps } from '../printablesTheme';
import '../PrintSheet.css';

export default function ResultsSheet() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;

    const [{ data, fetching, error }] = useQuery({
        query: GET_RESULTS_SHEET,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const race = data?.race;
    const scoringStrategy: string = race?.scoringStrategy ?? 'TIMED';

    const sections = useMemo(
        () => resultsSections((race?.leaderboard ?? []) as ResultsEntry[], scoringStrategy),
        [race?.leaderboard, scoringStrategy],
    );
    const awards = useMemo(
        () => awardLines((race?.awards ?? []) as ResultsAward[]),
        [race?.awards],
    );

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    const anything = hasResults(sections, awards);

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
                        {sections.length} {sections.length === 1 ? 'table' : 'tables'}
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
                        <DerbyCar size={54} className="heat-sheet-mark" color="#ffffff" />
                        <div>
                        <h1>{race.name}</h1>
                        <p>
                            {formatEventDate(race.dateTime)}
                            {race.location ? ` · ${race.location}` : ''}
                        </p>
                        </div>
                    </header>

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

                    {sections.map((section) => {
                        // The Den column says the same thing on every row of a
                        // den's own table, which is a column of noise on paper.
                        const isOverall = section.title === OVERALL;
                        return (
                        <section key={section.title} className="heat-sheet-round">
                            <h2>{section.title}</h2>
                            {/* Said once, on the table it applies to. The
                                standings are the qualifying rounds only (#17),
                                and a reader who does not know that will assume
                                the final is folded in. */}
                            {isOverall && (
                                <p className="results-note">
                                    Qualifying rounds only. Championship placings are in the
                                    awards above.
                                </p>
                            )}
                            <table>
                                <thead>
                                    <tr>
                                        <th className="heat-sheet-num">Place</th>
                                        <th className="heat-sheet-num">Car #</th>
                                        <th>Racer</th>
                                        {isOverall && <th>Den</th>}
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
                                            {isOverall && <td>{row.denName}</td>}
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
