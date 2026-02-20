import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSubscription, useQuery } from 'urql';
import Icon from '@mdi/react';
import RacerAvatar from '../components/RacerAvatar';
import { mdiFire, mdiChevronDoubleRight, mdiTrophy, mdiTimerOutline, mdiVideo } from '@mdi/js';
import { 
  LeaderboardSubscription, 
  OnDeckSubscription, 
  CurrentlyRacingSubscription, 
  TimingStatsSubscription,
  ActiveFreeRaceHeatSubscription
} from '../graphql/observation';

const GET_INITIAL_DATA = `
  query GetInitialData($id: Int!) {
    race(raceId: $id) {
      id
      racers {
        id
        firstName
        lastName
        carNumber
        racerImageUrl
        carName
      }
    }
  }
`;

interface Standing {
  racerId: number;
  score: number;
  heatsCompleted: number;
  rank: number;
}

export default function Observation() {
  const { raceId } = useParams<{ raceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = parseInt(raceId || '0');
  
  const isProjectorMode = searchParams.get('projector') === 'true';
  const shouldCycle = searchParams.get('cycle') === 'true';
  const cycleInterval = parseInt(searchParams.get('cycle_interval') || '10000');
  
  const initialView = (searchParams.get('view') as 'standings' | 'timing') || 'standings';
  const [activeTab, setActiveTab] = useState<'standings' | 'timing'>(initialView);

  // Auto-cycling logic
  useEffect(() => {
    if (!shouldCycle) return;

    const interval = setInterval(() => {
      setActiveTab(prev => prev === 'standings' ? 'timing' : 'standings');
    }, cycleInterval);

    return () => clearInterval(interval);
  }, [shouldCycle, cycleInterval]);

  // Sync tab with URL if view param changes externally
  useEffect(() => {
    const view = searchParams.get('view');
    if (view === 'standings' || view === 'timing') {
      setActiveTab(view);
    }
  }, [searchParams]);

  // Initial query for static-ish data (racers)
  const [initialResult] = useQuery({
    query: GET_INITIAL_DATA,
    variables: { id },
    pause: !id || isNaN(id),
  });

  const { data: initialData } = initialResult;

  // Subscriptions for real-time data
  const [{ data: leaderboardData }] = useSubscription({
    query: LeaderboardSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: onDeckData }] = useSubscription({
    query: OnDeckSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: currentlyRacingData }] = useSubscription({
    query: CurrentlyRacingSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: timingStatsData }] = useSubscription({
    query: TimingStatsSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const [{ data: activeFreeRaceData }] = useSubscription({
    query: ActiveFreeRaceHeatSubscription,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  });

  const racersMap = useMemo(() => {
    const map: Record<number, any> = {};
    initialData?.race?.racers.forEach((r: any) => map[r.id] = r);
    return map;
  }, [initialData]);

  if (!id || isNaN(id)) return <div className="container" style={{ padding: '20px' }}>Invalid Race ID</div>;

  const officialCurrentHeat = currentlyRacingData?.currentlyRacing;
  const nextHeatRacers = onDeckData?.onDeck || [];
  const standings = (leaderboardData?.leaderboard || []) as Standing[];
  const lastHeatResults = timingStatsData?.timingStats;
  const activeFreeRace = activeFreeRaceData?.activeFreeRaceHeat;

  const isExhibition = !officialCurrentHeat && activeFreeRace;
  
  const currentHeatRacers = useMemo(() => {
    if (officialCurrentHeat?.laneResults) {
      try {
        const assignments = JSON.parse(officialCurrentHeat.laneResults);
        return assignments.map((a: any) => racersMap[a.racer_id]).filter(Boolean);
      } catch {
        return [];
      }
    }
    if (isExhibition && activeFreeRace?.laneAssignments) {
      try {
        const assignments = JSON.parse(activeFreeRace.laneAssignments);
        return assignments.map((a: any) => racersMap[a.racer_id]).filter(Boolean);
      } catch {
        return [];
      }
    }
    return [];
  }, [officialCurrentHeat, isExhibition, activeFreeRace, racersMap]);

  const renderHeatCard = (title: string, racers: any[], isNext: boolean = false, iconPath?: string, heatInfo?: string, exhibition?: boolean) => {
    const isEmpty = racers.length === 0;

    return (
      <div style={{ 
        flex: 1, 
        minWidth: '300px', 
        background: isEmpty ? '#f5f5f5' : 'white', 
        borderRadius: '8px', 
        padding: '20px', 
        boxShadow: isEmpty ? 'none' : '0 2px 8px rgba(0,0,0,0.1)', 
        borderTop: `5px solid ${isNext ? '#999' : '#d32f2f'}`,
        opacity: isEmpty ? 0.7 : 1,
        textAlign: isEmpty ? 'center' : 'left'
      }}>
        <h2 style={{ 
          marginTop: 0, 
          fontSize: '1.5rem', 
          color: isNext ? '#666' : '#333', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          justifyContent: isEmpty ? 'center' : 'flex-start'
        }}>
          {iconPath && <Icon path={iconPath} size={1} color={isNext ? '#666' : '#d32f2f'} />}
          <span>{title}</span>
          {exhibition && (
            <span style={{
              background: 'var(--cub-scouting-gold)',
              color: '#333',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              padding: '2px 8px',
              borderRadius: '12px',
              marginLeft: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Exhibition
            </span>
          )}
          {heatInfo && (
            <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#666', marginLeft: 'auto' }}>({heatInfo})</span>
          )}
        </h2>
        
        {isEmpty ? (
          <p>No heat scheduled</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
            {racers.map((racer: any, idx: number) => (
              <div key={racer.id || idx} style={{ textAlign: 'center', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#888' }}>Lane {idx + 1}</div>
                <RacerAvatar 
                  racer={{
                    id: racer.id,
                    first_name: racer.firstName,
                    last_name: racer.lastName,
                    racer_image_url: racer.racerImageUrl
                  }}
                  size="80px"
                  style={{ margin: '0 auto 5px', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                />
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {racer.firstName} {racer.lastName}
                </div>
                {racer.carNumber && <div style={{ fontSize: '0.8rem', color: '#666' }}>Car #{racer.carNumber}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`container ${isProjectorMode ? 'projector-mode' : ''}`} style={{ maxWidth: '100%', padding: isProjectorMode ? '40px' : '20px' }}>
      {!isProjectorMode && (
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={() => window.open(`${window.location.pathname}?projector=true&view=${activeTab}`, '_blank')}
            style={{
              padding: '10px 20px',
              borderRadius: '20px',
              border: '2px solid var(--scouting-blue)',
              background: 'transparent',
              color: 'var(--scouting-blue)',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Icon path={mdiVideo} size={0.8} />
            Launch Projector Mode
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
        {renderHeatCard(
          "Now Racing", 
          currentHeatRacers, 
          false, 
          mdiFire, 
          officialCurrentHeat ? `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.heatNumber}` : undefined,
          isExhibition
        )}
        {renderHeatCard(
          "On Deck", 
          nextHeatRacers, 
          true, 
          mdiChevronDoubleRight
        )}
      </div>

      {!isProjectorMode && (
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => setActiveTab('standings')}
            style={{
              padding: '10px 20px',
              borderRadius: '20px',
              border: 'none',
              background: activeTab === 'standings' ? 'var(--cub-scouting-gold)' : '#eee',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold'
            }}
          >
            <Icon path={mdiTrophy} size={0.8} />
            Standings
          </button>
          <button 
            onClick={() => setActiveTab('timing')}
            style={{
              padding: '10px 20px',
              borderRadius: '20px',
              border: 'none',
              background: activeTab === 'timing' ? 'var(--cub-scouting-gold)' : '#eee',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold'
            }}
          >
            <Icon path={mdiTimerOutline} size={0.8} />
            Timing Stats
          </button>
        </div>
      )}
      
      {isProjectorMode && (
        <h1 style={{ textAlign: 'center', fontSize: '4rem', marginBottom: '40px' }}>
          {activeTab === 'standings' ? 'Current Standings' : 'Last Heat Results'}
        </h1>
      )}

      {activeTab === 'standings' ? (
        <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ backgroundColor: 'var(--cub-scouting-gold)', color: '#333' }}>
              <tr>
                <th style={{ padding: '15px' }}>Rank</th>
                <th style={{ padding: '15px' }}>Racer</th>
                <th style={{ padding: '15px', textAlign: 'right' }}>Avg Time</th>
                <th style={{ padding: '15px', textAlign: 'right' }}>Runs</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s: Standing, idx: number) => {
                const racer = racersMap[s.racerId];
                return (
                  <tr key={s.racerId} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#333' }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: '15px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <RacerAvatar 
                          racer={{
                            id: s.racerId,
                            first_name: racer?.firstName || '',
                            last_name: racer?.lastName || '',
                            racer_image_url: racer?.racerImageUrl
                          }}
                          size="100px"
                          style={{ border: '3px solid white', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
                        />
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                            {racer ? `${racer.firstName} ${racer.lastName}` : `Racer #${s.racerId}`}
                          </div>
                          {racer?.carNumber && (
                            <div style={{ color: '#666', fontSize: '0.9rem' }}>Car #{racer.carNumber}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '15px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 'bold' }}>{s.score.toFixed(4)}s</td>
                    <td style={{ padding: '15px', textAlign: 'right', fontSize: '1.1rem' }}>{s.heatsCompleted}</td>
                  </tr>
                );
              })}
              {standings.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center' }}>No results yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          {lastHeatResults ? (
            <div>
              <h2 style={{ textAlign: 'center', marginBottom: '30px' }}>
                Last Completed: {lastHeatResults.roundName} / Heat {lastHeatResults.heatNumber}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {[...lastHeatResults.lanes]
                  .sort((a, b) => (a.place || 99) - (b.place || 99))
                  .map((lane) => (
                  <div 
                    key={lane.laneNumber} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '20px', 
                      background: lane.place === 1 ? 'rgba(212, 175, 55, 0.1)' : '#f9f9f9',
                      borderRadius: '12px',
                      borderLeft: `10px solid ${lane.place === 1 ? '#d4af37' : '#ddd'}`
                    }}
                  >
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', width: '60px', textAlign: 'center' }}>
                      {lane.place}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{lane.racerName}</div>
                      <div style={{ color: '#666' }}>{lane.carName || `Lane ${lane.laneNumber}`}</div>
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {lane.time?.toFixed(3)}s
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>
              <Icon path={mdiTimerOutline} size={3} color="#eee" />
              <h3>Waiting for the first heat to complete...</h3>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
