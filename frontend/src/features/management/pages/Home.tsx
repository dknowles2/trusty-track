import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, gql } from 'urql';
import { CREATE_PRACTICE_RACE, CREATE_RACE } from '../graphql/queries';
import Modal from '../../../components/ui/Modal';
import RaceSetupWizard from '../components/RaceSetupWizard';
import { buildCreateRaceInput, type RaceSetupData } from '../raceInput';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiFlagCheckered, mdiVideo, mdiSchool, mdiDotsHorizontal, mdiAccountGroup, mdiPencil } from '@mdi/js';
import logoFullUrl from '../../../assets/logo_full_transparent.png';
import LockedBadge from '../../core/components/LockedBadge';

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
}

interface PracticeRace {
    id: number;
    name: string;
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
            showAlert("Failed to create race", "Error");
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
            showAlert("Could not create a practice race", "Error");
        } finally {
            startingPractice.current = false;
        }
    };

    const races: Race[] = data?.races || [];
    const practiceRace: PracticeRace | null = data?.practiceRace ?? null;

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                 <img src={logoFullUrl} alt="Trusty Track Logo" style={{ maxWidth: '300px', marginBottom: '1rem' }} />
                 <h1>Welcome to Trusty Track</h1>
                 <p>Select a race to manage or create a new one.</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Your Races</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
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
                    <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            {!fetching && !error && (
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
                            {races.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>
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
                                </td></tr>
                            ) : races.map(race => (
                                <tr key={race.id} style={{ borderBottom: '1px solid var(--divider-color)' }}>
                                    <td style={{ padding: '15px' }}>
                                        {/* Goes to the Roster page — the race's central hub, and
                                            the same destination the overflow menu's own "Roster"
                                            entry below names explicitly (#589). The title attribute
                                            says so on hover for anyone who expected this to open
                                            race settings instead. */}
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Link
                                                to={`/race/${race.id}`}
                                                title="Go to the roster & check-in"
                                                style={{ fontWeight: 'bold', color: 'var(--scouting-blue)', textDecoration: 'none', fontSize: '1.1rem' }}
                                            >
                                                {race.name}
                                            </Link>
                                            {race.isLocked && <LockedBadge />}
                                        </span>
                                    </td>
                                    <td className="mobile-hide" style={{ padding: '15px' }}>
                                        {race.dateTime ? new Date(race.dateTime).toLocaleString() : '-'}
                                    </td>
                                    <td className="mobile-hide" style={{ padding: '15px' }}>{race.location || '-'}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.registeredCount || 0}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.checkedInCount || 0}</td>
                                     <td style={{ padding: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                        {/* Same words as the race navigation row (Roster, Control,
                                            Live) rather than a third vocabulary — "View" here and
                                            "Live" there were the same destination under two names
                                            (#589). */}
                                        <Link to={`/race/${race.id}/control`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Icon path={mdiFlagCheckered} size={0.7} /> Control
                                        </Link>
                                        <Link to={`/race/${race.id}/observation`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Icon path={mdiVideo} size={0.7} /> Live
                                        </Link>
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
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
