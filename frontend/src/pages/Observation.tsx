import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSubscription, useQuery } from 'urql';
import Icon from '@mdi/react';
import RacerAvatar from '../components/RacerAvatar';
import { mdiFire, mdiChevronDoubleRight, mdiTrophy, mdiTimerOutline, mdiVideo } from '@mdi/js';
import TimerStatusBadge from '../components/timer/TimerStatusBadge';
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
      track {
        id
      }
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
  const [searchParams] = useSearchParams();
  const id = parseInt(raceId || '0');
  
  const isProjectorMode = searchParams.get('projector') === 'true';
  const shouldCycle = searchParams.get('cycle') === 'true';
  const cycleInterval = parseInt(searchParams.get('cycle_interval') || '10000');
  
  const initialView = (searchParams.get('view') as 'standings' | 'timing') || 'standings';
  const [activeTab, setActiveTab] = useState<'standings' | 'timing'>(initialView);
  
  const [showResultsOverlay, setShowResultsOverlay] = useState(false);
  const [overlayData, setOverlayData] = useState<any>(null);
  const [lastProcessedHeatId, setLastProcessedHeatId] = useState<string | null>(null);

  // Auto-cycling logic (disabled in projector mode)
  useEffect(() => {
    if (!shouldCycle || isProjectorMode) return;

    const interval = setInterval(() => {
      setActiveTab(prev => prev === 'standings' ? 'timing' : 'standings');
    }, cycleInterval);

    return () => clearInterval(interval);
  }, [shouldCycle, cycleInterval, isProjectorMode]);

  // Sync tab with URL if view param changes externally
  useEffect(() => {
    const view = searchParams.get('view');
    if (view === 'standings' || view === 'timing') {
      setActiveTab(view);
    }
  }, [searchParams]);

  // Ensure body scroll is hidden in projector mode
  useEffect(() => {
    if (isProjectorMode) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isProjectorMode]);

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

  // Effect to trigger heat result overlay
  useEffect(() => {
    if (!isProjectorMode || !timingStatsData?.timingStats) return;

    const stats = timingStatsData.timingStats;
    const heatId = `${stats.roundName}-${stats.heatNumber}`;

    if (heatId !== lastProcessedHeatId) {
      setOverlayData(stats);
      setShowResultsOverlay(true);
      setLastProcessedHeatId(heatId);
    }
  }, [timingStatsData, isProjectorMode, lastProcessedHeatId]);

  // Effect to handle overlay timeout
  useEffect(() => {
    if (showResultsOverlay) {
      const timer = setTimeout(() => {
        setShowResultsOverlay(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showResultsOverlay, lastProcessedHeatId]);

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
      <div className="heat-card" style={{ 
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
        <h2 className="heat-card-title" style={{ 
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
              <div key={racer.id || idx} className="heat-card-racer" style={{ textAlign: 'center', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>
                <div className="heat-card-lane" style={{ fontWeight: 'bold', marginBottom: '5px', color: '#888' }}>Lane {idx + 1}</div>
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
                <div className="heat-card-racer-name" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {racer.firstName} {racer.lastName}
                </div>
                {racer.carNumber && <div className="heat-card-car-number" style={{ fontSize: '0.8rem', color: '#666' }}>Car #{racer.carNumber}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderResultsOverlay = () => {
    if (!showResultsOverlay || !overlayData) return null;

    const sortedLanes = [...overlayData.lanes].sort((a, b) => (a.place || 99) - (b.place || 99));

    return (
      <div className="results-overlay">
        <h1 className="overlay-title">Heat Results</h1>
        <div className="overlay-results-list">
          {sortedLanes.map((lane, idx) => (
            <div 
              key={lane.laneNumber} 
              className={`overlay-result-item ${lane.place === 1 ? 'first-place' : lane.place === 2 ? 'second-place' : lane.place === 3 ? 'third-place' : ''}`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <div className="overlay-rank" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', minWidth: '300px', width: 'auto' }}>
                {lane.place === 1 && <Icon path={mdiTrophy} size={6} color="#FFD700" />}
                {lane.place === 2 && <Icon path={mdiTrophy} size={5} color="#C0C0C0" />}
                {lane.place === 3 && <Icon path={mdiTrophy} size={4} color="#CD7F32" />}
                <span style={{ fontSize: '5rem', lineHeight: 1 }}>
                  {lane.place === 1 ? '1st' : lane.place === 2 ? '2nd' : lane.place === 3 ? '3rd' : (lane.place || '-')}
                </span>
              </div>
              <RacerAvatar 
                racer={{
                  id: 0,
                  first_name: lane.racerName,
                  last_name: '',
                  racer_image_url: lane.racerImageUrl
                }}
                size="120px"
                style={{ margin: '0 40px', border: '4px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
              />
              <div className="overlay-racer-info">
                <div className="overlay-racer-name">{lane.racerName}</div>
                <div className="overlay-car-name">{lane.carName || `Lane ${lane.laneNumber}`}</div>
              </div>
              <div className="overlay-time">
                {lane.time?.toFixed(3)}s
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- STANDARD MODE RENDER ---
  if (!isProjectorMode) {
    return (
      <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
        {renderResultsOverlay()}
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {initialData?.race?.track?.id && (
            <TimerStatusBadge trackId={initialData.race.track.id} />
          )}
          <button 
            onClick={() => window.open(`${window.location.pathname}?projector=true`, '_blank')}
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

        <div className="heat-cards-layout" style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
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
        
        {activeTab === 'standings' ? (
          <div className="standings-table-wrapper" style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
            <table className="standings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                    <tr key={s.racerId} className="standing-row" style={{ borderBottom: '1px solid #eee' }}>
                      <td className="standing-rank" style={{ padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#333' }}>
                        {idx + 1}
                      </td>
                      <td className="standing-racer" style={{ padding: '15px' }}>
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
                            <div className="standing-racer-name" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                              {racer ? `${racer.firstName} ${racer.lastName}` : `Racer #${s.racerId}`}
                            </div>
                            {racer?.carNumber && (
                              <div className="standing-car-number" style={{ color: '#666', fontSize: '0.9rem' }}>Car #{racer.carNumber}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="standing-time" style={{ padding: '15px', textAlign: 'right', fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 'bold' }}>{s.score.toFixed(4)}s</td>
                      <td className="standing-runs" style={{ padding: '15px', textAlign: 'right', fontSize: '1.1rem' }}>{s.heatsCompleted}</td>
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
          <div className="timing-list-wrapper" style={{ background: '#fff', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
            {lastHeatResults ? (
              <div>
                <h2 className="timing-header" style={{ textAlign: 'center', marginBottom: '30px' }}>
                  Last Completed: {lastHeatResults.roundName} / Heat {lastHeatResults.heatNumber}
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {[...lastHeatResults.lanes]
                    .sort((a, b) => (a.place || 99) - (b.place || 99))
                    .map((lane) => (
                    <div 
                      key={lane.laneNumber} 
                      className="timing-list-item"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        padding: '20px', 
                        background: lane.place === 1 ? 'rgba(212, 175, 55, 0.1)' : '#f9f9f9',
                        borderRadius: '12px',
                        borderLeft: `10px solid ${lane.place === 1 ? '#d4af37' : '#ddd'}`
                      }}
                    >
                      <div className="timing-rank" style={{ fontSize: '2rem', fontWeight: 'bold', width: '60px', textAlign: 'center' }}>
                        {lane.place}
                      </div>
                      <div className="timing-racer-info" style={{ flex: 1 }}>
                        <div className="timing-racer-name" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{lane.racerName}</div>
                        <div className="timing-car-name" style={{ color: '#666' }}>{lane.carName || `Lane ${lane.laneNumber}`}</div>
                      </div>
                      <div className="timing-time" style={{ fontSize: '2.5rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
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

  // --- PROJECTOR MODE RENDER ---
  const renderProjectorRacers = (racers: any[], isNowRacing: boolean) => {
    if (racers.length === 0) {
      return (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#666', fontSize: '3vmin' }}>
          No heat scheduled
        </div>
      );
    }
    
    return (
      <div style={{ display: 'flex', height: '100%', gap: '2vmin' }}>
        {racers.map((racer: any, idx: number) => (
          <div key={racer.id || idx} className="projector-racer-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#222', borderRadius: '1.5vmin', padding: '2vmin', textAlign: 'center' }}>
            {/* Priority 1: Racer Name */}
            <div className="projector-racer-name" style={{ fontWeight: 'bold', fontSize: isNowRacing ? '4.5vmin' : '3.5vmin', color: '#fff', marginBottom: '1.5vmin', lineHeight: 1.1 }}>
              {racer.firstName} {racer.lastName}
            </div>
            
            {/* Priority 2: Picture */}
            <RacerAvatar 
              racer={{
                id: racer.id,
                first_name: racer.firstName,
                last_name: racer.lastName,
                racer_image_url: racer.racerImageUrl
              }}
              size={isNowRacing ? "16vmin" : "12vmin"}
              style={{ margin: '0 auto', border: '0.4vmin solid white', boxShadow: '0 0.5vmin 1vmin rgba(0,0,0,0.3)' }}
            />
            
            {/* Priority 3: Lane Number (Only prominent for Now Racing, very small or omitted for On Deck) */}
            <div className="projector-racer-lane-car" style={{ marginTop: '1.5vmin', display: 'flex', flexDirection: 'column', gap: '0.5vmin' }}>
              <div style={{ color: isNowRacing ? '#bbb' : '#666', fontSize: isNowRacing ? '2.5vmin' : '1.8vmin', fontWeight: isNowRacing ? 'bold' : 'normal' }}>
                Lane {idx + 1}
              </div>
              {racer.carNumber && (
                <div style={{ color: '#777', fontSize: isNowRacing ? '2vmin' : '1.5vmin' }}>
                  Car #{racer.carNumber}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const top5Standings = standings.slice(0, 5);
  const nowRacingHeatInfo = officialCurrentHeat ? `Round ${officialCurrentHeat.roundNumber}, Heat ${officialCurrentHeat.heatNumber}` : undefined;

  return (
    <div className="container projector-mode" style={{ maxWidth: '100%', padding: '2vmin', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      {renderResultsOverlay()}
      
      <div className="projector-grid" style={{ display: 'flex', flex: 1, gap: '3vmin', height: '100%' }}>
        {/* Left Column: Active and Upcoming Heats */}
        <div className="projector-left-col" style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', gap: '3vmin', boxSizing: 'border-box' }}>
          
          {/* Now Racing */}
          <div className="projector-heat-panel" style={{ flex: '3', display: 'flex', flexDirection: 'column', background: '#111', borderRadius: '1.5vmin', padding: '2.5vmin', borderTop: '1vmin solid #d32f2f', boxSizing: 'border-box' }}>
            <h2 style={{ fontSize: '4vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid #333', marginBottom: '2vmin' }}>
              <Icon path={mdiFire} size="4vmin" color="#d32f2f" />
              Now Racing
              {nowRacingHeatInfo && <span style={{ color: '#888', fontSize: '2.5vmin', marginLeft: 'auto', fontWeight: 'normal' }}>({nowRacingHeatInfo})</span>}
              {isExhibition && <span style={{ background: 'var(--cub-scouting-gold)', color: '#000', fontSize: '2vmin', padding: '0.5vmin 1.5vmin', borderRadius: '2vmin', marginLeft: 'auto' }}>EXHIBITION</span>}
            </h2>
            <div style={{ flex: 1 }}>
              {renderProjectorRacers(currentHeatRacers, true)}
            </div>
          </div>

          {/* On Deck */}
          <div className="projector-heat-panel" style={{ flex: '2', display: 'flex', flexDirection: 'column', background: '#111', borderRadius: '1.5vmin', padding: '2.5vmin', borderTop: '1vmin solid #999', opacity: nextHeatRacers.length === 0 ? 0.7 : 1, boxSizing: 'border-box' }}>
            <h2 style={{ fontSize: '3.5vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', gap: '1.5vmin', borderBottom: '2px solid #333', marginBottom: '2vmin', color: '#aaa' }}>
              <Icon path={mdiChevronDoubleRight} size="3.5vmin" color="#aaa" />
              On Deck
            </h2>
            <div style={{ flex: 1 }}>
              {renderProjectorRacers(nextHeatRacers, false)}
            </div>
          </div>
        </div>

        {/* Right Column: Top 5 Standings */}
        <div className="projector-right-col" style={{ flex: '0 0 calc(35% - 3vmin)', display: 'flex', flexDirection: 'column', background: '#111', borderRadius: '1.5vmin', overflow: 'hidden', padding: '2.5vmin', borderTop: '1vmin solid var(--cub-scouting-gold)', boxSizing: 'border-box' }}>
          <h2 style={{ fontSize: '3.5vmin', margin: 0, paddingBottom: '1.5vmin', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5vmin', borderBottom: '2px solid #333', marginBottom: '2vmin' }}>
            <Icon path={mdiTrophy} size="3.5vmin" color="var(--cub-scouting-gold)" />
            Current Standings
          </h2>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {top5Standings.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', height: '100%', tableLayout: 'fixed' }}>
                <tbody>
                  {top5Standings.map((s: Standing, idx: number) => {
                    const racer = racersMap[s.racerId];
                    return (
                      <tr key={s.racerId} style={{ borderBottom: idx < top5Standings.length - 1 ? '1px solid #333' : 'none' }}>
                        <td className="projector-standings-rank-col" style={{ padding: '1.5vmin 0', width: '15%' }}>
                          <span style={{ fontSize: '4vmin', fontWeight: 'bold', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#888' }}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="projector-standings-racer-col" style={{ padding: '1.5vmin', width: '55%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vmin', minWidth: 0 }}>
                            <RacerAvatar 
                              racer={{
                                id: s.racerId,
                                first_name: racer?.firstName || '',
                                last_name: racer?.lastName || '',
                                racer_image_url: racer?.racerImageUrl
                              }}
                              size="6vmin"
                              style={{ border: '0.2vmin solid #555', flexShrink: 0 }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                              <span style={{ fontSize: '2.5vmin', fontWeight: 'bold', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                {racer ? `${racer.firstName}` : `Racer`}
                              </span>
                              <span style={{ fontSize: '2vmin', fontWeight: 'bold', color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                {racer ? `${racer.lastName}` : `#${s.racerId}`}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="projector-standings-time-col" style={{ padding: '1.5vmin 0', width: '30%', textAlign: 'right' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                            <span style={{ fontSize: '3.5vmin', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--cub-scouting-gold)', lineHeight: '1' }}>
                              {s.score.toFixed(3)}
                            </span>
                            <span style={{ fontSize: '1.5vmin', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1vmin', marginTop: '0.5vmin' }}>
                              Avg Time
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#666', fontSize: '3vmin' }}>
                No results yet.
              </div>
            )}
            
            {/* Empty rows filler if less than 5 to keep height consistent */}
            {top5Standings.length > 0 && top5Standings.length < 5 && Array.from({ length: 5 - top5Standings.length }).map((_, i) => (
               <div key={`empty-${i}`} style={{ flex: 1, borderTop: '1px dashed #333', minHeight: '8vmin' }}></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
