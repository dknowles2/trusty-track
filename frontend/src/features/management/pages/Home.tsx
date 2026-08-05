import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, gql } from 'urql';
import { CREATE_RACE } from '../graphql/queries';
import Modal from '../../../components/ui/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import { useAlert } from '../../../context/AlertContext';
import { Icon } from '@mdi/react';
import { mdiPlus, mdiFlagCheckered, mdiEye } from '@mdi/js';
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
    const [showCreate, setShowCreate] = useState(false);
    // Location state check removed as per user request

    const [{ data, fetching, error }, reexecuteRaces] = useQuery({
        query: GET_RACES,
    });

    const [, createRace] = useMutation(CREATE_RACE);

    const handleCreate = async (formData: RaceFormData) => {
        try {
            // Map snake_case to camelCase for GQL input
            const raceInput = {
                name: formData.name,
                dateTime: formData.date_time,
                location: formData.location,
                trackId: formData.track_id,
                scoringStrategy: formData.scoring_strategy,
                carNumberingStrategy: formData.car_numbering_strategy,
                globalStartNumber: formData.global_start_number,
                championshipTrophies: formData.championship_trophies,
            };
            const result = await createRace({ race: raceInput });
            if (result.error) {
                throw result.error;
            }
            setShowCreate(false);
            reexecuteRaces({ requestPolicy: 'network-only' });
        } catch (e) {
            console.error("Failed to create race", e);
            showAlert("Failed to create race", "Error");
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
                 <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon path={mdiPlus} size={0.8} /> Create New Race
                </button>
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
            {error && <p>Error loading races: {error.message}</p>}
            {!fetching && !error && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
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
                                <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>No races found. Create one to get started!</td></tr>
                            ) : races.map(race => (
                                <tr key={race.id} style={{ borderBottom: '1px solid #eee' }}>
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
