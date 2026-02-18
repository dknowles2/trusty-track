import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from 'urql';
import Icon from '@mdi/react';
import RacerAvatar from '../components/RacerAvatar';
import { mdiFire, mdiChevronDoubleRight } from '@mdi/js';

const GET_OBSERVATION_DATA = `
  query GetObservationData($id: Int!) {
    race(raceId: $id) {
      id
      heats {
        id
        heatNumber
        roundNumber
        roundName
        laneResults
      }
      racers {
        id
        firstName
        lastName
        carNumber
        racerImageUrl
      }
      leaderboard {
        racerId
        firstName
        lastName
        carNumber
        score
        heatsCompleted
        rank
      }
    }
    activeFreeRaceHeat(raceId: $id) {
      id
      laneAssignments
      laneResults
      createdAt
    }
  }
`;

interface Standing {
  racerId: number;
  score: number;
  heatsCompleted: number;
  rank: number;
}

interface Heat {
  id: number;
  roundNumber: number;
  heatNumber: number;
  roundName: string | null;
  laneResults: string;
}

export default function Observation() {
  const { raceId } = useParams<{ raceId: string }>();
  const id = parseInt(raceId || '0');

  const [result, reExecute] = useQuery({
    query: GET_OBSERVATION_DATA,
    variables: { id },
    pause: !id || isNaN(id),
    requestPolicy: 'network-only'
  });

  const { data, fetching, error } = result;

  useEffect(() => {
    if (!id || isNaN(id)) return;
    const interval = setInterval(() => {
      reExecute({ requestPolicy: 'network-only' });
    }, 5000);
    return () => clearInterval(interval);
  }, [id, reExecute]);

  if (error) {
    return <div className="container" style={{ padding: '20px' }}>Error loading observation data</div>;
  }

  if (fetching && !data) return <div className="container" style={{ padding: '20px' }}>Loading Standings...</div>;

  const race = data?.race;
  if (!race && !fetching) return <div className="container" style={{ padding: '20px' }}>Race not found</div>;

  const racersMap: Record<number, any> = {};
  race?.racers.forEach((r: any) => racersMap[r.id] = r);

  const heats: Heat[] = (race?.heats || []).map((h: any) => ({
    id: h.id,
    roundNumber: h.roundNumber,
    heatNumber: h.heatNumber,
    roundName: h.roundName,
    laneResults: h.laneResults
  }));

  const sortedHeats = [...heats].sort((a, b) => {
    if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
    return a.heatNumber - b.heatNumber;
  });

  const uncompleted = sortedHeats.filter(h => {
    const results = h.laneResults ? JSON.parse(h.laneResults) : [];
    return !(results.length > 0 && results[0].time !== null);
  });

  const officialCurrentHeat = uncompleted.length > 0 ? uncompleted[0] : null;
  const nextHeat = uncompleted.length > 1 ? uncompleted[1] : null;

  const activeFreeRaceHeat = data?.activeFreeRaceHeat ?? null;
  const freeRaceIsActive = activeFreeRaceHeat && !activeFreeRaceHeat.laneResults;
  const nowRacingIsExhibition = !officialCurrentHeat && freeRaceIsActive;

  // Build a synthetic Heat-like object from the free race heat for renderHeatCard
  const freeRaceAsHeat = freeRaceIsActive
    ? {
        id: activeFreeRaceHeat.id,
        roundNumber: 0,
        heatNumber: 0,
        roundName: 'Exhibition',
        laneResults: activeFreeRaceHeat.laneAssignments,
      }
    : null;

  const currentHeat = officialCurrentHeat ?? (nowRacingIsExhibition ? freeRaceAsHeat : null);

  const standings = (race?.leaderboard || []) as Standing[];

  const renderHeatCard = (title: string, heat: Heat | null, isNext: boolean = false, iconPath?: string, isExhibition: boolean = false) => {
    if (!heat) return (
      <div style={{ flex: 1, minWidth: '300px', background: '#f5f5f5', borderRadius: '8px', padding: '20px', textAlign: 'center', opacity: 0.7 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {iconPath && <Icon path={iconPath} size={0.8} />}
          {title}
        </h3>
        <p>No heat scheduled</p>
      </div>
    );

    const assignments = heat.laneResults ? JSON.parse(heat.laneResults) : [];

    return (
      <div style={{ flex: 1, minWidth: '300px', background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderTop: `5px solid ${isNext ? '#999' : '#d32f2f'}` }}>
        <h2 style={{ marginTop: 0, fontSize: '1.5rem', color: isNext ? '#666' : '#333', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {iconPath && <Icon path={iconPath} size={1} color={isNext ? '#666' : '#d32f2f'} />}
          <span>{title}</span>
          {isExhibition && (
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
          {!isExhibition && (
            <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#666', marginLeft: 'auto' }}>(Round {heat.roundNumber}, Heat {heat.heatNumber})</span>
          )}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
          {assignments.map((a: any) => {
            const racer = racersMap[a.racer_id];
            return (
              <div key={a.lane} style={{ textAlign: 'center', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#888' }}>Lane {a.lane}</div>
                <RacerAvatar 
                  racer={{
                    id: a.racer_id,
                    first_name: racer?.firstName || '',
                    last_name: racer?.lastName || '',
                    racer_image_url: racer?.racerImageUrl
                  }}
                  size="80px"
                  style={{ margin: '0 auto 5px', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                />
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {racer ? `${racer.firstName} ${racer.lastName}` : `Racer #${a.racer_id}`}
                </div>
                {racer?.carNumber && <div style={{ fontSize: '0.8rem', color: '#666' }}>Car #{racer.carNumber}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="container" style={{ maxWidth: '100%', padding: '20px' }}>
      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
        {renderHeatCard("Now Racing", currentHeat, false, mdiFire, !!nowRacingIsExhibition)}
        {renderHeatCard("On Deck", nextHeat, true, mdiChevronDoubleRight)}
      </div>

      <h1>Live Standings</h1>
      
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
    </div>
  );
}
