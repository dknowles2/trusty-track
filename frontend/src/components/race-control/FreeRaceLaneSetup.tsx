import React, { useState } from 'react';
import { useQuery } from 'urql';
import Icon from '@mdi/react';
import { mdiDice5, mdiPencil, mdiShuffle, mdiFlagCheckered } from '@mdi/js';
import { SerialProxyConnector } from './SerialProxyConnector';
import { TimerStatusBadge } from './TimerStatusBadge';
import { RacerCombobox } from '../RacerCombobox';

export interface LaneAssignment {
  lane: number;
  racerId: number | null;
}

interface FreeRaceLaneSetupProps {
  raceId: number;
  laneCount: number;
  onStart: (assignments: LaneAssignment[]) => void;
  timerType: string | null;
  trackId?: number | null;
}

interface Racer {
  id: number;
  firstName: string;
  lastName: string;
  carNumber: number | null;
}

type Mode = 'random' | 'manual';

export const FreeRaceLaneSetup: React.FC<FreeRaceLaneSetupProps & { racers: Record<number, Racer> }> = ({
  raceId,
  laneCount,
  onStart,
  racers,
  timerType,
  trackId,
}) => {
  const [mode, setMode] = useState<Mode>('random');
  const [manualAssignments, setManualAssignments] = useState<LaneAssignment[]>(
    Array.from({ length: laneCount }, (_, i) => ({ lane: i + 1, racerId: null }))
  );

  const [randomResult, reExecuteRandom] = useQuery({
    query: `
      query GetRandomFreeRaceLanes($raceId: Int!) {
        randomFreeRaceLanes(raceId: $raceId) {
          lane
          racerId
        }
      }
    `,
    variables: { raceId },
    requestPolicy: 'network-only',
  });

  const randomLanes: LaneAssignment[] = (
    randomResult.data?.randomFreeRaceLanes || []
  ).map((l: { lane: number; racerId: number | null }) => ({
    lane: l.lane,
    racerId: l.racerId,
  }));

  const allRacersList = Object.values(racers);

  const handleReshuffle = () => {
    reExecuteRandom({ requestPolicy: 'network-only' });
  };

  const handleManualChange = (lane: number, racerId: number | null) => {
    setManualAssignments((prev) =>
      prev.map((a) => (a.lane === lane ? { ...a, racerId } : a))
    );
  };

  const currentAssignments = mode === 'random' ? randomLanes : manualAssignments;
  const hasAnyRacer = currentAssignments.some((a) => a.racerId != null);

  const showProxyControls = timerType === 'AUTO_DETECT_PROXY';

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderTop: '8px solid var(--scouting-blue)' }}>
        {showProxyControls && trackId != null && (
          <SerialProxyConnector trackId={trackId} />
        )}
        <div style={{
          background: '#e3f2fd',
          border: '1px solid var(--scouting-blue)',
          borderRadius: '12px',
          padding: '10px 16px',
          marginBottom: '20px',
          fontWeight: 'bold',
          color: 'var(--scouting-blue)',
        }}>
          Free Race — results do not affect standings
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '2rem' }}>Free Race Setup</h2>
          {trackId != null && <TimerStatusBadge trackId={trackId} />}
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', background: '#e0e0e0', padding: '4px', borderRadius: '20px', marginBottom: '20px', width: 'fit-content', gap: '4px' }}>
          <button
            onClick={() => setMode('random')}
            style={{
              padding: '8px 20px',
              borderRadius: '16px',
              border: 'none',
              background: mode === 'random' ? 'white' : 'transparent',
              boxShadow: mode === 'random' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              fontWeight: mode === 'random' ? 'bold' : 'normal',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Icon path={mdiDice5} size={0.8} /> Random
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{
              padding: '8px 20px',
              borderRadius: '16px',
              border: 'none',
              background: mode === 'manual' ? 'white' : 'transparent',
              boxShadow: mode === 'manual' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              fontWeight: mode === 'manual' ? 'bold' : 'normal',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Icon path={mdiPencil} size={0.8} /> Manual
          </button>
        </div>

        {mode === 'random' ? (
          <div>
            {randomResult.fetching ? (
              <p>Loading random assignments...</p>
            ) : (
              <div style={{ display: 'grid', gap: '15px', marginBottom: '20px' }}>
                {randomLanes.map((a) => {
                  const racer = a.racerId ? racers[a.racerId] : null;
                  return (
                    <div key={a.lane} style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '15px',
                      background: '#f9f9f9',
                      borderRadius: '8px',
                      borderLeft: '5px solid var(--scouting-blue)'
                    }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {a.lane}</div>
                      <div style={{ flex: 1 }}>
                        {a.racerId === null ? (
                          <em style={{ color: '#999', fontSize: '1.2rem' }}>(empty)</em>
                        ) : (
                          <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                            {racer?.firstName} {racer?.lastName}
                            {racer?.carNumber != null && <span style={{ color: '#666', fontWeight: 'normal' }}> #{racer.carNumber}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={handleReshuffle}
                disabled={randomResult.fetching}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  background: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Icon path={mdiShuffle} size={0.8} /> Re-shuffle
              </button>
              <button
                onClick={() => onStart(randomLanes)}
                disabled={!hasAnyRacer || randomResult.fetching}
                className="primary-btn"
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '6px',
                  background: hasAnyRacer ? 'var(--scouting-blue)' : '#ccc',
                  color: hasAnyRacer ? 'white' : '#999',
                  cursor: hasAnyRacer ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Icon path={mdiFlagCheckered} size={0.8} /> Start Free Race Heat
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gap: '15px', marginBottom: '20px' }}>
              {manualAssignments.map((a) => {
                const takenIds = new Set(
                  manualAssignments
                    .filter((x) => x.lane !== a.lane && x.racerId !== null)
                    .map((x) => x.racerId)
                );
                const available = allRacersList.filter((r) => !takenIds.has(r.id));
                return (
                  <div key={a.lane} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '15px',
                    background: '#f9f9f9',
                    borderRadius: '8px',
                    borderLeft: '5px solid var(--scouting-blue)'
                  }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '80px', color: '#666' }}>Lane {a.lane}</div>
                    <RacerCombobox
                      racers={available}
                      value={a.racerId ?? undefined}
                      onChange={(racerId) => handleManualChange(a.lane, racerId ?? null)}
                      placeholder="— Select racer —"
                      style={{ minWidth: '350px' }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onStart(manualAssignments)}
                disabled={!hasAnyRacer}
                className="primary-btn"
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '6px',
                  background: hasAnyRacer ? 'var(--scouting-blue)' : '#ccc',
                  color: hasAnyRacer ? 'white' : '#999',
                  cursor: hasAnyRacer ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Icon path={mdiFlagCheckered} size={0.8} /> Start Free Race Heat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
