import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, type NavigateFunction } from 'react-router-dom';
import { useQuery, useMutation, gql } from 'urql';
import { CREATE_PRACTICE_RACE, CREATE_RACE } from '../graphql/queries';
import Modal from '../../../components/ui/Modal';
import RaceSetupWizard from '../components/RaceSetupWizard';
import { buildCreateRaceInput, type RaceSetupData } from '../raceInput';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiFlagCheckered, mdiMonitorMultiple, mdiSchool, mdiDotsHorizontal, mdiAccountGroup, mdiPencil, mdiTrophy, mdiPrinter } from '@mdi/js';
import logoFullUrl from '../../../assets/logo_full_transparent.png';
import LockedBadge from '../../core/components/LockedBadge';
import RaceStatusBadge, { type RaceStatus } from '../components/RaceStatusBadge';
import { raceListSummary } from '../homeRaceList';
import { useNarrowViewport } from '../../../utils/useNarrowViewport';

// Below this width the table (950px-plus at full column count, per #1137's
// own measurement) no longer fits — a phone at 390px and a portrait tablet
// at 820px both land under it. Chosen over the roster table's own 768px
// mobile breakpoint because the tablet-portrait case is specifically what
// this issue reports as still broken at 768: nothing is hidden there and the
// table still needs 950px.
const CARD_BREAKPOINT = 900;

// #847 item 3's other half: "finished / in progress / not started" per
// race, alongside the Standings route below. `status` is computed
// server-side from the race's official heats and batched the same way
// `registeredCount`/`checkedInCount` are (`RequestLoaders.prime_race_status`)
// — see `.claude/rules/roster.md`'s "The Home page race list" for why this
// query has to stay at a constant SQL cost regardless of race count.
const GET_RACES = gql`
    query GetRaces {
        races {
            id
            name
            dateTime
            location
            registeredCount
            checkedInCount
            # Whether the race is locked against further edits — the row's
            # "Locked" badge (issue 585).
            isLocked
            # NOT_STARTED / IN_PROGRESS / FINISHED — the row's status badge
            # (issue 847).
            status
        }
        practiceRace {
            id
            name
        }
    }
`;

interface Race {
    id: number;
    name: string;
    dateTime: string;
    location: string;
    registeredCount: number;
    checkedInCount: number;
    isLocked: boolean;
    status: RaceStatus;
}

interface PracticeRace {
    id: number;
    name: string;
}

/**
 * The race name link, plus its status/locked badges — shared by the table
 * row and the card (#1137), so the two never drift on which link carries
 * the "Go to the roster & check-in" title or which badges show for which
 * race. `layout: 'card'` pins the badge group to the far right of a full
 * width row, matching the issue's own mock ("2026 Pinewood Derby [In
 * progress]"); `'row'` keeps the original flat, left-aligned group the
 * table has always used — the two render identically once a nested flex
 * group's own `gap` matches the outer one it replaced.
 */
function RaceTitleBadges({ race, layout }: { race: Race; layout: 'row' | 'card' }) {
    return (
        <span
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                justifyContent: layout === 'card' ? 'space-between' : 'flex-start',
                width: layout === 'card' ? '100%' : undefined,
            }}
        >
            <Link
                to={`/race/${race.id}`}
                title="Go to the roster & check-in"
                style={{ fontWeight: 'bold', color: 'var(--scouting-blue)', textDecoration: 'none', fontSize: '1.1rem' }}
            >
                {race.name}
            </Link>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {race.status && <RaceStatusBadge status={race.status} />}
                {race.isLocked && <LockedBadge />}
            </span>
        </span>
    );
}

/**
 * Control, Displays and the `⋯` overflow menu — shared by the table row and
 * the card (#1137). Rendered as two groups (Control+Displays, then the
 * dropdown) rather than three flat siblings so a caller can lay them out
 * either way with one `justifyContent` on its own wrapper: `flex-end` for
 * the table's right-aligned cell (unchanged from before this issue), or
 * `space-between` for the card's full-width button row from the mock
 * ("[Control] [Displays] ... [⋯]").
 *
 * Not wrapped in anything `overflow: auto` — the dropdown used to be
 * clipped at the table's right edge because the table's own horizontal
 * scroll wrapper clipped it too; the card has no such wrapper, so the same
 * menu markup opens fully visible there for free.
 */
function RaceQuickActions({
    race,
    openMenuRaceId,
    setOpenMenuRaceId,
    navigate,
}: {
    race: Race;
    openMenuRaceId: number | null;
    setOpenMenuRaceId: (id: number | null) => void;
    navigate: NavigateFunction;
}) {
    const linkStyle = { textDecoration: 'none', fontSize: '0.9rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' } as const;
    return (
        <>
            {/* Same words as the race navigation row (Roster, Control,
                Displays) rather than a third vocabulary — "View" here
                and "Live" there were the same destination under two
                names (#589); the row's own sixth link is Displays now,
                not Live, so this follows it there too (#958). */}
            <span style={{ display: 'flex', gap: '10px' }}>
                <Link to={`/race/${race.id}/control`} className="secondary-btn" style={linkStyle}>
                    <Icon path={mdiFlagCheckered} size={0.7} /> Control
                </Link>
                <Link to={`/race/${race.id}/displays`} className="secondary-btn" style={linkStyle}>
                    <Icon path={mdiMonitorMultiple} size={0.7} /> Displays
                </Link>
            </span>
            <div className="dropdown" style={{ position: 'relative' }}>
                <button
                    className="secondary-btn"
                    onClick={() => setOpenMenuRaceId(openMenuRaceId === race.id ? null : race.id)}
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', fontSize: '0.9rem' }}
                    aria-label={`More actions for ${race.name}`}
                    aria-expanded={openMenuRaceId === race.id}
                    data-testid={`race-more-menu-${race.id}`}
                >
                    <Icon path={mdiDotsHorizontal} size={0.8} />
                </button>
                {openMenuRaceId === race.id && (
                    <div className="dropdown-content" style={{ display: 'block', right: 0, left: 'auto', minWidth: '180px' }}>
                        <button
                            onClick={() => { setOpenMenuRaceId(null); navigate(`/race/${race.id}`); }}
                            data-testid={`race-menu-roster-${race.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Icon path={mdiAccountGroup} size={0.7} /> Roster
                        </button>
                        {/* The route to a race's results Home never had (#847):
                            Control and Live are both race-day screens, and once
                            the last heat is recorded neither one is where an
                            operator reading standings, printing certificates or
                            finding an old race's results the next morning wants
                            to land. Same word, same route as the navigation row's
                            own "Standings" — not gated on the race being "finished",
                            since that reads fine mid-race too, and the alternative
                            (a per-row heats-and-lanes fetch to decide) would put
                            this never-pruned list's own query back on the O(races)
                            path #749 removed it from — see
                            .claude/rules/roster.md's "The Home page race list". */}
                        <button
                            onClick={() => { setOpenMenuRaceId(null); navigate(`/race/${race.id}/standings`); }}
                            data-testid={`race-menu-standings-${race.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Icon path={mdiTrophy} size={0.7} /> Standings
                        </button>
                        {/* The print hub (#957) — everything printable for
                            this race in one place, rather than starting at
                            the roster's own overflow to reach a document
                            that has nothing to do with the roster. Same
                            reasoning as Standings just above: a visitor the
                            next morning wants certificates, not check-in. */}
                        <button
                            onClick={() => { setOpenMenuRaceId(null); navigate(`/race/${race.id}/print`); }}
                            data-testid={`race-menu-print-${race.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Icon path={mdiPrinter} size={0.7} /> Print
                        </button>
                        {/* Opens the edit form that has always lived on the
                            Roster page, rather than a new `/settings` route
                            for a form that has never had one of its own —
                            see RaceDetails's `?edit=true` handling. */}
                        <button
                            onClick={() => { setOpenMenuRaceId(null); navigate(`/race/${race.id}?edit=true`); }}
                            data-testid={`race-menu-edit-${race.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Icon path={mdiPencil} size={0.7} /> Edit race
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}

export default function Home() {
    const { showAlert } = useAlert();
    const navigate = useNavigate();
    const [showCreate, setShowCreate] = useState(false);
    // Location state check removed as per user request

    // Which row's overflow menu is open, one at a time (#589). The two
    // destinations reached for over and over — Control, Live — stay as
    // their own buttons; Roster (the race title link's own destination,
    // named explicitly here too) and Edit race sit behind the `⋯`, the same
    // split the roster toolbar itself makes between what is reached for
    // constantly and what is set up once.
    const [openMenuRaceId, setOpenMenuRaceId] = useState<number | null>(null);

    useEffect(() => {
        if (openMenuRaceId === null) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element;
            if (target.closest('.dropdown')) return;
            setOpenMenuRaceId(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openMenuRaceId]);

    const [{ data, fetching, error }] = useQuery({
        query: GET_RACES,
    });

    const [, createRace] = useMutation(CREATE_RACE);
    const [practiceResult, createPracticeRace] = useMutation(CREATE_PRACTICE_RACE);

    const handleCreate = async (formData: RaceSetupData) => {
        try {
            const raceInput = buildCreateRaceInput(formData);
            const result = await createRace({ race: raceInput });
            if (result.error) {
                throw result.error;
            }
            setShowCreate(false);
            // Open the race that was just created, as the nav bar's own
            // "New Race…" has always done. Two routes to the same mutation
            // behaved differently: this one dropped you back on a list to find
            // the race you had that moment named, and the next thing anyone
            // wants after creating a race is to set it up.
            navigate(`/race/${result.data.createRace.id}`);
        } catch (e) {
            console.error("Failed to create race", e);
            // A duplicate name is the one refusal the wizard can actually
            // reach and the operator can actually fix (#748) — the server
            // names the race, and a generic "Failed to create race" gave
            // no clue that the fix was a different name.
            showAlert(errorText(e, "Failed to create race"), "Error");
        }
    };

    // Re-entrancy guard for `handlePractice`, on top of the button's own
    // `disabled={practiceResult.fetching}` below. Two clicks can land before
    // urql's fetching flag has made it into a render — a synchronous ref
    // closes that window rather than trusting the timing (#588).
    const startingPractice = useRef(false);

    // The rehearsal (#201). It lands on Race Control rather than the roster,
    // because what somebody wants to practise is race day — the roster is the
    // part they have already done at a kitchen table.
    //
    // Resumes the rehearsal already under way rather than building another
    // one (#588) — the mutation decides that server-side, using the same
    // rule `practiceRace` below reads to choose the button's wording, so the
    // frontend never has to guess which race that is. `startNew` is the
    // deliberate "start over" action, offered only once there is something
    // to start over from.
    const handlePractice = async (startNew = false) => {
        if (startingPractice.current) return;
        startingPractice.current = true;
        try {
            const result = await createPracticeRace({ startNew });
            if (result.error) throw result.error;
            navigate(`/race/${result.data.createPracticeRace.id}/control/race`);
        } catch (e) {
            console.error("Failed to create practice race", e);
            showAlert(errorText(e, "Could not create a practice race"), "Error");
        } finally {
            startingPractice.current = false;
        }
    };

    const races: Race[] = data?.races || [];
    const practiceRace: PracticeRace | null = data?.practiceRace ?? null;

    // Below 900px the table can't hold its own columns (#1137) — see
    // `CARD_BREAKPOINT`'s own comment above for why 900 rather than the
    // roster table's 768px.
    const isNarrow = useNarrowViewport(CARD_BREAKPOINT);

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                 <img src={logoFullUrl} alt="Trusty Track Logo" style={{ maxWidth: '300px', marginBottom: '1rem' }} />
                 <h1>Welcome to Trusty Track</h1>
                 <p>Select a race to manage or create a new one.</p>
            </div>

            <div className="home-races-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>Your Races</h2>
                <div className="home-races-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* Rehearsal, beside the real thing rather than hidden
                        away. The night before an event is when a volunteer
                        wants it, and they will not go looking for it. Once
                        one exists, this resumes it rather than piling up
                        another (#588); "Start new" is the deliberate way
                        past that. */}
                    <button
                        onClick={() => handlePractice(false)}
                        className="secondary-btn"
                        data-testid="practice-race"
                        disabled={practiceResult.fetching}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                        <Icon path={mdiSchool} size={0.8} />
                        {practiceResult.fetching
                            ? (practiceRace ? 'Resuming…' : 'Setting up…')
                            : (practiceRace ? 'Resume practice race' : 'Try a practice race')}
                    </button>
                    {practiceRace && (
                        <button
                            onClick={() => handlePractice(true)}
                            data-testid="practice-race-start-new"
                            disabled={practiceResult.fetching}
                            title="Start a new rehearsal instead of resuming this one"
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                fontSize: '0.85rem',
                                color: 'var(--scouting-blue)',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                            }}
                        >
                            Start new
                        </button>
                    )}
                    <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <Icon path={mdiPlus} size={0.8} /> Create New Race
                    </button>
                </div>
            </div>

            {/* Create Race Modal */}
            {/* The setup wizard (#662): a few questions and a ready-made list
                of groups in front of the same create form as before, which is
                its last step. Wider than the form alone, for the groups table. */}
            <Modal
                isOpen={showCreate}
                onClose={() => setShowCreate(false)}
                title="Create New Race Event"
                maxWidth="680px"
            >
                <RaceSetupWizard
                    onSubmit={handleCreate}
                    onCancel={() => setShowCreate(false)}
                />
            </Modal>

            {fetching && <p>Loading races...</p>}
            {error && <p>{errorText(error, 'The list of races could not be loaded.')}</p>}
            {!fetching && !error && races.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', backgroundColor: 'var(--surface-color)', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    No races found. Create one to get started — or{' '}
                    <button
                        onClick={() => handlePractice(false)}
                        data-testid="practice-race-empty"
                        disabled={practiceResult.fetching}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'var(--scouting-blue)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                        }}
                    >
                        try a practice race
                    </button>{' '}
                    on a fake timer first.
                </div>
            )}
            {!fetching && !error && races.length > 0 && (isNarrow ? (
                // Below 900px: one card per race, in place of the table
                // (#1137) — see the issue for the phone/tablet-portrait
                // measurements that made the table unusable there. Not
                // wrapped in `overflow: auto`, unlike the table below, so
                // the `⋯` menu's own dropdown opens fully on screen.
                <div data-testid="race-cards">
                    {races.map(race => {
                        const summary = raceListSummary(race);
                        return (
                            <div
                                key={race.id}
                                data-testid={`race-card-${race.id}`}
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    borderRadius: '8px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                    padding: '15px',
                                    marginBottom: '12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                }}
                            >
                                <RaceTitleBadges race={race} layout="card" />
                                <div style={{ color: 'var(--text-muted-color)', fontSize: '0.9rem' }}>
                                    {summary.dateTimeLabel} · {summary.locationLabel}
                                </div>
                                <div style={{ color: 'var(--text-muted-color)', fontSize: '0.9rem' }}>
                                    {summary.registeredCount} registered · {summary.checkedInCount} checked in
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                                    <RaceQuickActions
                                        race={race}
                                        openMenuRaceId={openMenuRaceId}
                                        setOpenMenuRaceId={setOpenMenuRaceId}
                                        navigate={navigate}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'var(--surface-color)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left' }}>Event Name</th>
                                <th className="mobile-hide" style={{ padding: '15px', textAlign: 'left' }}>Date & Time</th>
                                <th className="mobile-hide" style={{ padding: '15px', textAlign: 'left' }}>Location</th>
                                <th className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>Registered</th>
                                <th className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>Checked In</th>
                                <th style={{ padding: '15px', textAlign: 'right' }}>Quick Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {races.map(race => {
                                const summary = raceListSummary(race);
                                return (
                                    <tr key={race.id} style={{ borderBottom: '1px solid var(--divider-color)' }}>
                                        <td style={{ padding: '15px' }}>
                                            {/* Goes to the Roster page — the race's central hub, and
                                                the same destination the overflow menu's own "Roster"
                                                entry below names explicitly (#589). The title attribute
                                                says so on hover for anyone who expected this to open
                                                race settings instead. */}
                                            <RaceTitleBadges race={race} layout="row" />
                                        </td>
                                        <td className="mobile-hide" style={{ padding: '15px' }}>{summary.dateTimeLabel}</td>
                                        <td className="mobile-hide" style={{ padding: '15px' }}>{summary.locationLabel}</td>
                                        <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{summary.registeredCount}</td>
                                        <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{summary.checkedInCount}</td>
                                        <td style={{ padding: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                            <RaceQuickActions
                                                race={race}
                                                openMenuRaceId={openMenuRaceId}
                                                setOpenMenuRaceId={setOpenMenuRaceId}
                                                navigate={navigate}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
}
