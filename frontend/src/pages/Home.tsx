import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';

interface Race {
    id: number;
    name: string;
    date_time: string;
    location: string;
}

interface Group {
    id: number;
    name: string;
}

export default function Home() {
    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    // New Race Form State
    const [newRaceData, setNewRaceData] = useState({
        name: '',
        date_time: '',
        location: '',
        group_id: 1 // Default to 1
    });

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

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await apiClient.post('/races/', newRaceData);
            setShowCreate(false);
            fetchRaces();
            // Reset form
            setNewRaceData({ name: '', date_time: '', location: '', group_id: 1 });
        } catch (e) {
            console.error("Failed to create race", e);
            alert("Failed to create race");
        }
    };

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                 <img src="/src/assets/logo_full.png" alt="Trusty Track Logo" style={{ maxWidth: '400px', marginBottom: '1rem' }} />
                 <h1>Welcome to Trusty Track</h1>
                 <p>Select a race to manage or create a new one.</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Your Races</h2>
                <button onClick={() => setShowCreate(!showCreate)}>
                    {showCreate ? 'Cancel' : 'Create New Race'}
                </button>
            </div>

            {showCreate && (
                <div style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
                    <h3>New Race Event</h3>
                    <form onSubmit={handleCreate} style={{ display: 'grid', gap: '1rem', maxWidth: '500px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Event Name *</label>
                            <input 
                                type="text" 
                                value={newRaceData.name} 
                                onChange={e => setNewRaceData({...newRaceData, name: e.target.value})}
                                placeholder="e.g. 2024 Pinewood Derby"
                                required
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Date & Time</label>
                            <input 
                                type="datetime-local" 
                                value={newRaceData.date_time} 
                                onChange={e => setNewRaceData({...newRaceData, date_time: e.target.value})}
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Location</label>
                            <input 
                                type="text" 
                                value={newRaceData.location} 
                                onChange={e => setNewRaceData({...newRaceData, location: e.target.value})}
                                placeholder="e.g. School Gym"
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <button type="submit" style={{ justifySelf: 'start' }}>Create Race</button>
                    </form>
                </div>
            )}

            {loading ? <p>Loading races...</p> : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
                            <tr>
                                <th style={{ padding: '15px', textAlign: 'left' }}>Event Name</th>
                                <th style={{ padding: '15px', textAlign: 'left' }}>Date & Time</th>
                                <th style={{ padding: '15px', textAlign: 'left' }}>Location</th>
                                <th style={{ padding: '15px', textAlign: 'right' }}>Quick Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {races.length === 0 ? (
                                <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center' }}>No races found. Create one to get started!</td></tr>
                            ) : races.map(race => (
                                <tr key={race.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '15px' }}>
                                        <Link to={`/race/${race.id}`} style={{ fontWeight: 'bold', color: 'var(--scouting-blue)', textDecoration: 'none', fontSize: '1.1rem' }}>
                                            {race.name}
                                        </Link>
                                    </td>
                                    <td style={{ padding: '15px' }}>
                                        {race.date_time ? new Date(race.date_time).toLocaleString() : '-'}
                                    </td>
                                    <td style={{ padding: '15px' }}>{race.location || '-'}</td>
                                    <td style={{ padding: '15px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                        <Link to={`/race/${race.id}/control`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 10px' }}>Control</Link>
                                        <Link to={`/race/${race.id}/observation`} className="secondary-btn" style={{ textDecoration: 'none', fontSize: '0.9rem', padding: '5px 10px' }}>View</Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
             
             <div style={{ marginTop: '3rem', borderTop: '1px solid #eee', paddingTop: '1rem', textAlign: 'center' }}>
                <Link to="/system-config" style={{ color: '#666', textDecoration: 'none' }}>System Configuration</Link>
             </div>
        </div>
    );
}
