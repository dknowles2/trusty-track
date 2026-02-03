import React from 'react';

interface Heat {
  id: number;
  round_number: number;
  heat_number: number;
  lane_results: string; // JSON
}

interface ScheduleManagementProps {
  heats: Heat[];
  generating: boolean;
  activeHeatId: number | null;
  onGenerate: () => void;
  onRunHeat: (heat: Heat, shouldStart?: boolean) => void;
  getRacerName: (id: number) => string;
}

export const ScheduleManagement: React.FC<ScheduleManagementProps> = ({
  heats,
  generating,
  activeHeatId,
  onGenerate,
  onRunHeat,
  getRacerName,
}) => {
  // Group Heats by Round for Schedule View
  const rounds: Record<number, Heat[]> = {};
  heats.forEach(h => {
      if (!rounds[h.round_number]) rounds[h.round_number] = [];
      rounds[h.round_number].push(h);
  });
  
  const sortedRounds = Object.keys(rounds).map(Number).sort((a,b) => a - b);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 'fit-content' }}>
          {/* Actions Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '15px' }}>
              <button 
                className="secondary-btn" 
                onClick={onGenerate}
                disabled={generating}
                style={{ boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}
              >
                {generating ? 'Generating...' : 'Regenerate Schedule'}
              </button>
          </div>

          <div style={{ 
              display: 'flex', 
              overflowX: 'auto', 
              gap: '20px', 
              paddingBottom: '20px',
              alignItems: 'flex-start',
              justifyContent: 'center'
          }}>
              {sortedRounds.map(roundNum => (
                  <div key={roundNum} style={{ 
                      minWidth: '350px', 
                      background: '#f5f5f5', 
                      borderRadius: '8px', 
                      padding: '10px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                      <h3 style={{ textAlign: 'center', margin: '0 0 15px 0', color: 'var(--scouting-blue)' }}>Round {roundNum}</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          {rounds[roundNum].map(heat => {
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
              ))}
          </div>
      </div>
    </div>
  );
};
