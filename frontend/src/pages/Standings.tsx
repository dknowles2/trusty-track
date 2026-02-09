import { useParams, Link } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import Icon from '@mdi/react';
import { mdiArrowLeft } from '@mdi/js';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface Race {
    id: number;
    name: string;
}

export default function Standings() {
    const { raceId } = useParams<{ raceId: string }>();
    const [race, setRace] = useState<Race | null>(null);

    useEffect(() => {
        const fetchRace = async () => {
            if (!raceId) return;
            try {
                const data = await apiClient.get(`/races/${raceId}`);
                setRace(data);
            } catch (e) {
                console.error("Failed to fetch race details", e);
            }
        };
        fetchRace();
    }, [raceId]);

    if (!raceId) return <div>Invalid Race ID</div>;

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ marginBottom: '2rem' }}>
                <Link to={`/race/${raceId}`} style={{ display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none', color: '#666', marginBottom: '1rem' }}>
                    <Icon path={mdiArrowLeft} size={0.8} /> Back to Race Details
                </Link>
                
                <h1 style={{ margin: 0, color: 'var(--scouting-blue)' }}>
                    {race ? `${race.name} - Standings` : 'Standings'}
                </h1>
            </div>

            <Leaderboard raceId={parseInt(raceId)} />
        </div>
    );
}
