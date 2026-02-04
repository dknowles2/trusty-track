import React, { useState } from 'react';
import { RoundConfigModal } from './RoundConfigModal';

interface Heat {
  id: number;
  round_number: number;
  round_id: number;
  heat_number: number;
  lane_results: string; // JSON
}

interface ScheduleManagementProps {
  raceId: number;
  heats: Heat[];
  generating: boolean;
  activeHeatId: number | null;
  onAddRound: (schedulingStrategy: string) => Promise<void>;
  onRegenerateRound: (roundId: number) => Promise<void>;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void | Promise<void>;
  getRacerName: (id: number) => string;
}

export const ScheduleManagement: React.FC<ScheduleManagementProps> = ({
  raceId: _raceId,
  heats,
  generating,
  activeHeatId,
  onAddRound,
  onRegenerateRound,
  onRunHeat,
  getRacerName,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Group Heats by Round for Schedule View
  const rounds: Record<number, Heat[]> = {};
  heats.forEach(h => {
      if (!rounds[h.round_number]) rounds[h.round_number] = [];
      rounds[h.round_number].push(h);
  });
  
  const sortedRounds = Object.keys(rounds).map(Number).sort((a,b) => a - b);

  const handleAddRound = async (schedulingStrategy: string) => {
    await onAddRound(schedulingStrategy);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 'fit-content' }}>
          {/* Actions Toolbar */}
          <div style={{ display: 'flex', justifyContent: sortedRounds.length > 0 ? 'space-between' : 'flex-end', alignItems: 'center', marginBottom: '15px', gap: '20px' }}>
              {sortedRounds.length > 0 && (
                <div style={{ textAlign: 'center', flex: 1, minWidth: '150px' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>
                        {sortedRounds.length} Round{sortedRounds.length > 1 ? 's' : ''}
                    </span>
                </div>
              )}
              <button 
                className="primary-btn" 
                onClick={() => setIsModalOpen(true)}
                disabled={generating}
                style={{ boxShadow: '0 2px 5px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}
              >
                Add Round
              </button>
          </div>

          <RoundConfigModal 
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSubmit={handleAddRound}
            currentRoundCount={sortedRounds.length}
          />

          {sortedRounds.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '60px 40px', 
              background: '#f9f9f9', 
              borderRadius: '8px',
              border: '2px dashed #ddd',
              color: '#666'
            }}>
              <p style={{ fontSize: '1.1rem', margin: '0 0 10px 0' }}>No rounds yet</p>
              <p style={{ fontSize: '0.9rem', margin: 0 }}>Click "Add Round" to create your first round and generate heats</p>
            </div>
          ) : (
            <div style={{ 
                display: 'flex', 
                overflowX: 'auto', 
                gap: '20px', 
                paddingBottom: '20px',
                alignItems: 'flex-start',
                justifyContent: 'center'
            }}>
                {sortedRounds.map(roundNum => {
                    const roundHeats = rounds[roundNum];
                    const roundId = roundHeats[0]?.round_id;
                    const isAnyStarted = roundHeats.some(h => {
                        if (!h.lane_results) return false;
                        const results = JSON.parse(h.lane_results);
                        return results.some((r: any) => r.time !== null);
                    });

                    return (
                        <div key={roundNum} style={{ 
                            minWidth: '350px', 
                            background: '#f5f5f5', 
                            borderRadius: '8px', 
                            padding: '10px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', marginBottom: '15px' }}>
                                <h3 style={{ margin: 0, color: 'var(--scouting-blue)' }}>Round {roundNum}</h3>
                                {!isAnyStarted && roundId && (
                                    <button
                                        onClick={() => onRegenerateRound(roundId)}
                                        className="secondary-btn"
                                        disabled={generating}
                                        style={{ 
                                            position: 'absolute', right: 0, padding: '2px 8px', fontSize: '0.7rem',
                                            display: 'flex', alignItems: 'center', gap: '3px'
                                        }}
                                        title="Refresh the schedule based on latest timing data"
                                    >
                                        <span>🔄</span> Regenerate
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                {roundHeats.map(heat => {
                                    const results = heat.lane_results ? JSON.parse(heat.lane_results) : [];
                                    const isCompleted = results.length > 0 && results[0].time !== null;
                                    const isRunning = activeHeatId === heat.id;
                                    
                                    return (
                                        <div key={heat.id} style={{ 
                                            background: '#fff', padding: '15px', borderRadius: '8px',
                                            borderLeft: isRunning ? '5px solid orange' : isCompleted ? '5px solid green' : '5px solid #ccc',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <span style={{ fontWeight: 'bold' }}>Heat {heat.heat_number}</span>
                                                <button 
                                                    className="primary-btn"
                                                    onClick={() => onRunHeat(heat, false)}
                                                    disabled={isRunning}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: '60px' }}
                                                >
                                                    {isRunning ? '...' : isCompleted ? 'Re-Run' : 'Run'}
                                                </button>
                                            </div>
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {results.map((r: any) => (
                                                    <div key={r.lane} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                                                        <span style={{ fontWeight: 'bold', width: '30px', color: '#666' }}>L{r.lane}</span>
                                                        <span style={{ flex: 1, paddingLeft: '5px' }}>{getRacerName(r.racer_id)}</span>
                                                        <span style={{ textAlign: 'right', minWidth: '50px', fontFamily: 'monospace' }}>
                                                            {r.time ? `${r.time}s` : ''}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
          )}
      </div>
    </div>
  );
};
