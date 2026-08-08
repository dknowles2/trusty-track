import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Icon } from '@mdi/react';
import { mdiAccountGroup, mdiTrophy, mdiChartBar, mdiMedal } from '@mdi/js';

export default function RaceModeToggle() {
    const navigate = useNavigate();
    const { raceId } = useParams<{ raceId: string }>();
    const location = useLocation();

    const id = raceId || '0';

    const isRoster = location.pathname === `/race/${id}` || location.pathname === `/race/${id}/`;
    const isStandings = location.pathname.includes('/standings');
    const isAwards = location.pathname.includes('/awards');
    const isStats = location.pathname.includes('/stats');

    const viewMode = isRoster
        ? 'ROSTER'
        : isStandings
          ? 'STANDINGS'
          : isAwards
            ? 'AWARDS'
            : isStats
              ? 'STATS'
              : '';

    const buttonStyle = (active: boolean) => ({
        padding: '6px 16px',
        fontSize: '0.95rem',
        whiteSpace: 'nowrap' as const,
        borderRadius: '20px',
        border: 'none',
        background: active ? 'white' : 'transparent',
        boxShadow: active ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
        fontWeight: active ? 'bold' : 'normal',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: active ? '#333' : '#666',
        transition: 'all 0.2s ease'
    });

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifyContent: 'center', margin: '0 auto' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', background: '#e0e0e0', padding: '5px', borderRadius: '25px' }}>
                <button
                    onClick={() => navigate(`/race/${id}`)}
                    style={buttonStyle(viewMode === 'ROSTER')}
                >
                    <Icon path={mdiAccountGroup} size={0.8} /> Roster
                </button>
                <button
                    onClick={() => navigate(`/race/${id}/standings`)}
                    style={buttonStyle(viewMode === 'STANDINGS')}
                >
                    <Icon path={mdiTrophy} size={0.8} /> Standings
                </button>
                <button
                    onClick={() => navigate(`/race/${id}/awards`)}
                    style={buttonStyle(viewMode === 'AWARDS')}
                >
                    <Icon path={mdiMedal} size={0.8} /> Awards
                </button>
                <button
                    onClick={() => navigate(`/race/${id}/stats`)}
                    style={buttonStyle(viewMode === 'STATS')}
                >
                    <Icon path={mdiChartBar} size={0.8} /> Stats
                </button>
            </div>
        </div>
    );
}
