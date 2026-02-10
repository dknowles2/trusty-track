import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import Modal from '../components/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import { useAlert } from '../context/AlertContext';
import Icon from '@mdi/react';
import { mdiPlus, mdiFlagCheckered, mdiEye } from '@mdi/js';

interface Race {
    id: number;
    name: string;
    date_time: string;
    location: string;
    registered_count: number;
    checked_in_count: number;
}

export default function Home() {
    const { showAlert } = useAlert();
    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        fetchRaces();
    }, []);

    const fetchRaces = async () => {
        try {
            const data = await apiClient.get('/races/');
            setRaces(data);
        } catch (e) {
            console.error("Failed to fetch races", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (data: RaceFormData) => {
        try {
            await apiClient.post('/races/', data);
            setShowCreate(false);
            fetchRaces();
        } catch (e) {
            console.error("Failed to create race", e);
            showAlert("Failed to create race", "Error");
        }
    };

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                 <img src="/src/assets/logo_full_transparent.png" alt="Trusty Track Logo" style={{ maxWidth: '300px', marginBottom: '1rem' }} />
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

            {loading ? <p>Loading races...</p> : (
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
                                        {race.date_time ? new Date(race.date_time).toLocaleString() : '-'}
                                    </td>
                                    <td className="mobile-hide" style={{ padding: '15px' }}>{race.location || '-'}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.registered_count || 0}</td>
                                    <td className="mobile-hide" style={{ padding: '15px', textAlign: 'center' }}>{race.checked_in_count || 0}</td>
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
             
             <div style={{ marginTop: '3rem', borderTop: '1px solid #eee', paddingTop: '1rem', textAlign: 'center' }}>
                <Link to="/system-settings" style={{ color: '#666', textDecoration: 'none' }}>System Settings</Link>
             </div>
        </div>
    );
}
