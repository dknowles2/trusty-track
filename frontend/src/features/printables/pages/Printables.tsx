import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from 'urql';
import { Icon } from '@mdi/react';
import { mdiArrowLeft, mdiPrinter } from '@mdi/js';

import {
    DOCUMENTS,
    parseIds,
    perSheet,
    racersToPrint,
    sheetCount,
    specFor,
    type DocumentSpec,
    type PrintableRacingGroup,
    type PrintableRace,
    type PrintableRacer,
} from '../documents';
import CarSticker from '../components/CarSticker';
import CheckInCode from '../components/CheckInCode';
import DriversLicense from '../components/DriversLicense';
import PitPass from '../components/PitPass';
import { GET_PRINTABLES } from '../graphql/queries';
import { printablesThemeRootProps } from '../printablesTheme';
import { useTerminology } from '../../../context/TerminologyContext';
import '../PrintSheet.css';

interface GQLRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | string;
    carName?: string;
    racingGroupId?: number;
    racerImageUrl?: string;
    carWeight?: number | null;
}

/**
 * The picker's own label for a document, resolved against terminology.
 *
 * `DOCUMENTS` is pure (`documents.ts` takes no React), so a label naming the
 * vehicle word — only the car label does — is filled in here rather than
 * baked into the static spec, the same "pure helper takes the word as a
 * parameter" split every other terminology-aware `.ts` file in this feature
 * uses (#496 stage 4). Every other document's label names nothing
 * configurable and passes through unchanged.
 *
 * The singular word, not the plural — "Car labels" reads as "labels for a
 * car", the same modifying-noun shape `CarSticker`'s own "{vehicle} Label"
 * header uses, not "labels for several cars".
 */
function labelFor(option: DocumentSpec, vehicle: string): string {
    return option.kind === 'car-sticker' ? `${vehicle} labels` : option.label;
}

/**
 * The print page: pick a document, look at the sheet, print it.
 *
 * Sheet-first rather than card-first. Nobody prints one pit pass — they print
 * the whole roster before check-in opens — so what is on screen is the paper,
 * and the browser's print dialog is the only other step.
 *
 * Which racers come from `?racers=`, carried over from whatever the roster had
 * selected. Nothing selected prints everyone.
 */
export default function Printables() {
    const { raceId } = useParams<{ raceId: string }>();
    const parsedRaceId = raceId ? parseInt(raceId) : 0;
    const [searchParams, setSearchParams] = useSearchParams();
    const { vehicle } = useTerminology();

    const [{ data, fetching, error }] = useQuery({
        query: GET_PRINTABLES,
        variables: { raceId: parsedRaceId },
        pause: !parsedRaceId,
    });

    const spec = specFor(searchParams.get('kind'));
    // Named rather than tested inline in the JSX below: `terminologyGuard`
    // scans raw text sitting between two JSX tags for the word "car", and
    // `spec.kind === 'car-sticker'` written there is exactly that — the kind
    // string, not display copy, but the guard cannot tell the two apart. An
    // identifier has no word boundary in the middle of it for `\bcar\b` to
    // match, the same reason "denominator" does not flag "den".
    const isCarLabel = spec.kind === 'car-sticker';

    // The car label's own "print before check-in" option (#617). A per-print
    // toggle rather than a stored setting: the same sheet gets run off twice
    // on the day — once before the scale opens, with the weight line left
    // blank on purpose, and again afterwards with the recorded weights — so
    // remembering the choice between visits would print the wrong one of the
    // two half the time.
    const [printBeforeCheckIn, setPrintBeforeCheckIn] = useState(false);

    const race: PrintableRace | null = data?.race
        ? {
              name: data.race.name,
              dateTime: data.race.dateTime,
              location: data.race.location,
          }
        : null;

    const racingGroups: PrintableRacingGroup[] = useMemo(() => data?.race?.racingGroups ?? [], [data]);

    // How much of a racer's name the pit passes and licences print (#552) —
    // resolved server-side. `CheckInCode` never receives this: it is scanned
    // by the check-in desk to identify a racer, the same job that keeps the
    // roster and check-in screens themselves at full names.
    const nameDisplay = data?.race?.resolvedNameDisplay ?? 'FULL';

    const cards: PrintableRacer[] = useMemo(() => {
        const racers: PrintableRacer[] = (data?.race?.racers ?? []).map((r: GQLRacer) => ({
            id: r.id,
            first_name: r.firstName,
            last_name: r.lastName,
            car_number: r.carNumber,
            car_name: r.carName,
            racing_group_id: r.racingGroupId,
            racer_image_url: r.racerImageUrl,
            car_weight: r.carWeight,
        }));
        return racersToPrint(racers, parseIds(searchParams.get('racers')));
    }, [data, searchParams]);

    const chooseKind = (kind: string) => {
        const next = new URLSearchParams(searchParams);
        next.set('kind', kind);
        // Replace, so Back returns to the roster rather than stepping through
        // every document type the operator looked at.
        setSearchParams(next, { replace: true });
    };

    if (fetching && !data) return <p style={{ padding: '2rem' }}>Loading…</p>;
    if (error) return <p style={{ padding: '2rem' }}>Could not load this race.</p>;
    if (!race) return <p style={{ padding: '2rem' }}>Race not found.</p>;

    const sheets = sheetCount(cards.length, spec);

    return (
        <div className="printables-page" {...printablesThemeRootProps(data?.initialConfig?.printablesTheme)}>
            <div className="printables-controls no-print">
                <div>
                    <Link
                        to={`/race/${parsedRaceId}`}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--print-primary-color)',
                            fontSize: '0.85rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <Icon path={mdiArrowLeft} size={0.7} /> Back to roster
                    </Link>
                    <h2 style={{ margin: 0 }}>Print</h2>
                </div>

                <div className="printables-kinds">
                    {DOCUMENTS.map((option) => (
                        <button
                            key={option.kind}
                            className="printables-kind"
                            aria-pressed={option.kind === spec.kind}
                            onClick={() => chooseKind(option.kind)}
                        >
                            <span className="printables-kind-label">{labelFor(option, vehicle)}</span>
                            <span className="printables-kind-blurb">{option.blurb}</span>
                        </button>
                    ))}
                </div>

                {isCarLabel && (
                    <label className="printables-option">
                        <input
                            type="checkbox"
                            checked={printBeforeCheckIn}
                            onChange={(e) => setPrintBeforeCheckIn(e.target.checked)}
                        />
                        Leave the weight blank (printing before check-in)
                    </label>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="printables-summary">
                        {cards.length} {cards.length === 1 ? 'card' : 'cards'} ·{' '}
                        {sheets} {sheets === 1 ? 'sheet' : 'sheets'} of Letter ·{' '}
                        {perSheet(spec)} per sheet
                    </span>
                    <button
                        className="primary-btn"
                        onClick={() => window.print()}
                        disabled={cards.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Icon path={mdiPrinter} size={0.8} /> Print
                    </button>
                </div>
            </div>

            {cards.length === 0 ? (
                <p className="no-print">
                    No racers to print. Add racers to the roster first.
                </p>
            ) : (
                <div
                    className="print-sheets"
                    style={
                        {
                            '--card-w': `${spec.widthIn}in`,
                            '--card-h': `${spec.heightIn}in`,
                            '--cols': spec.columns,
                        } as React.CSSProperties
                    }
                >
                    {cards.map((racer) => {
                        const racingGroup = racingGroups.find((d) => d.id === racer.racing_group_id);
                        if (spec.kind === 'pit-pass') {
                            return (
                                <PitPass
                                    key={racer.id}
                                    racer={racer}
                                    race={race}
                                    racingGroup={racingGroup}
                                    nameDisplay={nameDisplay}
                                />
                            );
                        }
                        if (spec.kind === 'drivers-license') {
                            return (
                                <DriversLicense
                                    key={racer.id}
                                    racer={racer}
                                    race={race}
                                    racingGroup={racingGroup}
                                    nameDisplay={nameDisplay}
                                />
                            );
                        }
                        if (isCarLabel) {
                            return (
                                <CarSticker
                                    key={racer.id}
                                    racer={racer}
                                    race={race}
                                    racingGroup={racingGroup}
                                    nameDisplay={nameDisplay}
                                    printBeforeCheckIn={printBeforeCheckIn}
                                />
                            );
                        }
                        return <CheckInCode key={racer.id} racer={racer} race={race} />;
                    })}
                </div>
            )}
        </div>
    );
}
