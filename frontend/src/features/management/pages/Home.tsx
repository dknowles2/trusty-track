import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, gql } from 'urql';
import { CREATE_PRACTICE_RACE, CREATE_RACE } from '../graphql/queries';
import Modal from '../../../components/ui/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import { buildCreateRaceInput } from '../raceInput';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiFlagCheckered, mdiEye, mdiSchool } from '@mdi/js';
import logoFullUrl from '../../../assets/logo_full_transparent.png';

const GET_RACES = gql`
    query GetRaces {
        races {
            id
            name
            dateTime
            location
            registeredCount
            checkedInCount
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
}

export default function Home() {
    const { showAlert } = useAlert();
    const navigate = useNavigate();
    const [showCreate, setShowCreate] = useState(false);
    // Location state check removed as per user request

    const [{ data, fetching, error }] = useQuery({
        query: GET_RACES,
    });

    const [, createRace] = useMutation(CREATE_RACE);
    const [practiceResult, createPracticeRace] = useMutation(CREATE_PRACTICE_RACE);

    const handleCreate = async (formData: RaceFormData) => {
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

    // The rehearsal (#201). It lands on Race Control rather than the roster,
    // because what somebody wants to practise is race day — the roster is the
    // part they have already done at a kitchen table.
    const handlePractice = async () => {
        try {
            const result = await createPracticeRace({});
            if (result.error) throw result.error;
            navigate(`/race/${result.data.createPracticeRace.id}/control/race`);
        } catch (e) {
            console.error("Failed to create practice race", e);
            showAlert("Could not create a practice race", "Error");
        }
    };

    const races: Race[] = data?.races || [];

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
                        wants it, and they will not go looking for it. */}
                    <button
                        onClick={handlePractice}
                        className="secondary-btn"
                        data-testid="practice-race"
                        disabled={practiceResult.fetching}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Icon path={mdiSchool} size={0.8} />
                        {practiceResult.fetching ? 'Setting up…' : 'Try a practice race'}
                    </button>
                    <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon path={mdiPlus} size={0.8} /> Create New Race
                    </button>
                </div>
            </div>

            {/* Create Race Modal */}
            <Modal
                isOpen={showCreate}
                onClose={() => setShowCreate(false)}
                title="Create New Race Event"
            >
                <RaceForm
                    onSubmit={handleCreate}
                    onCancel={() => setShowCreate(false)}
                    submitLabel="Create Race"
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
                                        onClick={handlePractice}
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
                                        <Link to={`/race/${race.id}`} style={{ fontWeight: 'bold', color: 'var(--scouting-blue)', textDecoration: 'none', fontSize: '1.1rem' }}>
                                            {race.name}
                                        </Link>
                                    </td>
                                    <td className="mobile-hide" style={{ padding: '15px' }}>
                                        {race.dateTime ? new Date(race.dateTime).toLocaleString() : '-'}
                                    </td>
                                    <td className="mobile-hide" style={{ padding: '15px' }}>{race.location || '-'}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.registeredCount || 0}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.checkedInCount || 0}</td>
                                     <td style={{ padding: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                        <Link to={`/race/${race.id}/control`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Icon path={mdiFlagCheckered} size={0.7} /> Control
                                        </Link>
                                        <Link to={`/race/${race.id}/observation`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Icon path={mdiEye} size={0.7} /> View
                                        </Link>
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
