import React, { useState, useEffect } from 'react';
import { useAlert } from '../../context/AlertContext';
import { useMutation } from 'urql';
import { CREATE_ROUND_WIZARD } from '../../graphql/raceDetails';
import Modal from '../Modal';

interface RoundWizardProps {
  isOpen: boolean;
  onClose: () => void;
  raceId: number;
  racerCount: number;
  denCount: number;
  laneCount: number;
  championshipTrophies: number;
  onCreated: () => void;
}

interface GeneralConfig {
  type: 'PACK' | 'DEN';
  runsPerLane: number;
}

interface ChampionshipConfig {
  id: string;
  name: string;
  source: 'PACK' | 'DEN';
  numTopRacers: number;
  runsPerLane: number;
}

// Helper to estimate duration (in minutes)
const ESTIMATED_HEAT_DURATION_MIN = 1.5;

export const RoundWizard: React.FC<RoundWizardProps> = ({
  isOpen,
  onClose,
  raceId,
  racerCount,
  denCount,
  laneCount,
  championshipTrophies,
  onCreated,
}) => {
  const [step, setStep] = useState(1);
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    type: 'PACK',
    runsPerLane: 1,
  });
  const [championshipRounds, setChampionshipRounds] = useState<ChampionshipConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlert();
  
  // GraphQL Mutation
  const [, createRoundWizardMutation] = useMutation(CREATE_ROUND_WIZARD);

  // Initialize defaults when opening
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setGeneralConfig({ type: 'PACK', runsPerLane: 1 });
      setChampionshipRounds([{
        id: 'champ-1',
        name: 'Grand Finals',
        source: 'PACK',
        numTopRacers: Math.max(championshipTrophies, laneCount), // Default to filling a heat
        runsPerLane: 1
      }]);
    }
  }, [isOpen, laneCount, championshipTrophies]);

  const calculateTotalHeats = () => {
    let heats = 0;
    
    // General Round
    // If Runs Per Lane = N, then we have roughly N * RacerCount / LaneCount heats
    heats += (racerCount * generalConfig.runsPerLane) / laneCount;

    // Championship Rounds
    for (const round of championshipRounds) {
      let participatingRacers = 0;
      if (round.source === 'PACK') {
        participatingRacers = round.numTopRacers;
      } else {
        participatingRacers = round.numTopRacers * denCount;
      }
       heats += (participatingRacers * round.runsPerLane) / laneCount;
    }

    return Math.ceil(heats);
  };

  const estimatedDuration = Math.ceil(calculateTotalHeats() * ESTIMATED_HEAT_DURATION_MIN);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const handleAddChampionshipRound = () => {
    setChampionshipRounds(prev => [
      ...prev,
      {
        id: `champ-${Date.now()}`,
        name: 'New Championship Round',
        source: 'PACK',
        numTopRacers: laneCount,
        runsPerLane: 1
      }
    ]);
  };

  const handleRemoveChampionshipRound = (id: string) => {
    setChampionshipRounds(prev => prev.filter(r => r.id !== id));
  };

  const updateChampionshipRound = (id: string, updates: Partial<ChampionshipConfig>) => {
    const nextRounds = championshipRounds.map(r => {
        if (r.id === id) return { ...r, ...updates };
        return r;
    });
    setChampionshipRounds(nextRounds);
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const config = {
        generalRound: {
          type: generalConfig.type,
          runsPerLane: generalConfig.runsPerLane,
        },
        championshipRounds: championshipRounds.map((r) => ({
          name: r.name,
          source: r.source,
          numTopRacers: r.numTopRacers,
          runsPerLane: r.runsPerLane,
        })),
      };
      
      const result = await createRoundWizardMutation({ raceId, config });
      
      if (result.error) {
          throw result.error;
      }
      
      onCreated();
      onClose();
    } catch (error: any) {
      console.error('Failed to create rounds via wizard:', error);
      const message = error.message || 'Unknown error';
      showAlert(`Failed to create rounds: ${message}`, "Error");
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '0.5rem'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.375rem',
    fontSize: '1rem',
    boxSizing: 'border-box'
  };

  const stepIndicatorStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    color: active ? '#2563eb' : '#9ca3af',
    fontWeight: active ? 500 : 400,
    fontSize: '0.875rem'
  });

  const stepNumberStyle = (active: boolean): React.CSSProperties => ({
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    marginRight: '0.5rem',
    borderColor: active ? '#2563eb' : '#d1d5db',
    backgroundColor: active ? '#eff6ff' : 'transparent',
    boxSizing: 'border-box'
  });

  const configCardStyle = (active: boolean): React.CSSProperties => ({
    border: '1px solid',
    borderRadius: '0.5rem',
    padding: '1rem',
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s',
    borderColor: active ? '#3b82f6' : '#e5e7eb',
    backgroundColor: active ? '#eff6ff' : 'transparent',
    boxSizing: 'border-box'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Race Schedule Wizard" maxWidth="650px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header Description */}
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: '#4b5563', fontSize: '0.875rem', marginTop: '-1rem', marginBottom: '1.5rem' }}>
            Quickly generate a complete race schedule based on your settings.
          </p>
          
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={stepIndicatorStyle(step >= 1)}>
              <span style={stepNumberStyle(step >= 1)}>1</span>
              General Rounds
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: '#d1d5db', margin: '0 0.5rem' }}></div>
            <div style={stepIndicatorStyle(step >= 2)}>
              <span style={stepNumberStyle(step >= 2)}>2</span>
              Championships
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: '#d1d5db', margin: '0 0.5rem' }}></div>
            <div style={stepIndicatorStyle(step >= 3)}>
              <span style={stepNumberStyle(step >= 3)}>3</span>
              Review
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '1.5rem' }}>
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={labelStyle}>Qualifying / General Round Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div 
                    style={configCardStyle(generalConfig.type === 'PACK')}
                    onClick={() => setGeneralConfig({ ...generalConfig, type: 'PACK' })}
                  >
                    <div style={{ fontWeight: 500 }}>All Pack</div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>Every racer races against everyone else in the pack.</div>
                  </div>
                  <div 
                    style={configCardStyle(generalConfig.type === 'DEN')}
                    onClick={() => setGeneralConfig({ ...generalConfig, type: 'DEN' })}
                  >
                    <div style={{ fontWeight: 500 }}>By Den</div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>Racers only race against others in their own Den initially.</div>
                  </div>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Runs Per Lane</label>
                <input 
                  type="number" 
                  min="1" 
                  max="4"
                  style={inputStyle}
                  value={generalConfig.runsPerLane}
                  onChange={(e) => setGeneralConfig({ ...generalConfig, runsPerLane: parseInt(e.target.value) || 1 })}
                />
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>How many times does each racer run in each lane? (Standard is 1)</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 500, color: '#111827', margin: 0 }}>Championship Rounds</h3>
                <button onClick={handleAddChampionshipRound} style={{ background: 'none', color: '#2563eb', fontSize: '0.875rem', padding: 0 }}>+ Add Round</button>
              </div>

              {championshipRounds.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#6b7280', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px dashed #d1d5db' }}>
                  No championship rounds configured.
                </div>
              )}

              {championshipRounds.map((round) => (
                <div key={round.id} style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', backgroundColor: '#f9fafb' }}>
                  <button 
                    onClick={() => handleRemoveChampionshipRound(round.id)}
                    style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', color: '#9ca3af', fontSize: '1.25rem', padding: '0 4px' }}
                    title="Remove Round"
                    data-testid="remove-round-btn"
                  >
                    &times;
                  </button>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Round Name</label>
                      <input 
                        type="text" 
                        style={{ ...inputStyle, fontSize: '0.875rem' }}
                        value={round.name}
                        onChange={(e) => updateChampionshipRound(round.id, { name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Advancement Source</label>
                      <select 
                        style={{ ...inputStyle, fontSize: '0.875rem' }}
                        value={round.source}
                        onChange={(e) => updateChampionshipRound(round.id, { source: e.target.value as 'PACK' | 'DEN' })}
                      >
                        <option value="PACK">Top Overall (Pack)</option>
                        <option value="DEN">Top per Den</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>
                        {round.source === 'PACK' ? 'Number of Finalists' : 'Advancing per Den'}
                      </label>
                      <input 
                        type="number" 
                        min="1"
                        style={{ ...inputStyle, fontSize: '0.875rem' }}
                        value={round.numTopRacers}
                        onChange={(e) => updateChampionshipRound(round.id, { numTopRacers: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Runs Per Lane</label>
                      <input 
                        type="number" 
                        min="1"
                        style={{ ...inputStyle, fontSize: '0.875rem' }}
                        value={round.runsPerLane}
                        onChange={(e) => updateChampionshipRound(round.id, { runsPerLane: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ backgroundColor: '#eff6ff', padding: '1rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem', marginRight: '0.75rem' }}>⏱️</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: '#1e3a8a' }}>Estimated Duration: ~{estimatedDuration} mins</div>
                  <div style={{ color: '#1d4ed8', fontSize: '0.875rem' }}>Total Heats: {calculateTotalHeats()}</div>
                </div>
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb' }}>
                  <h4 style={{ fontWeight: 'bold', color: '#111827', margin: 0 }}>1. {generalConfig.type === 'PACK' ? 'All Pack' : 'Den'} Round</h4>
                  <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0.25rem 0 0 0' }}>
                    {generalConfig.type === 'PACK' ? 'All racers compete against each other.' : 'Racers compete within their dens.'}
                    {' '}{generalConfig.runsPerLane > 1 && `(${generalConfig.runsPerLane} runs per lane)`}
                  </p>
                </div>
                {championshipRounds.map((round, idx) => (
                  <div key={round.id} style={{ padding: '1rem', borderBottom: idx === championshipRounds.length - 1 ? 'none' : '1px solid #e5e7eb' }}>
                    <h4 style={{ fontWeight: 'bold', color: '#111827', margin: 0 }}>{idx + 2}. {round.name}</h4>
                    <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0.25rem 0 0 0' }}>
                      Advances top {round.numTopRacers} racers
                      {round.source === 'DEN' ? ' from each Den' : ' overall'}.
                      {' '}{round.runsPerLane > 1 && `(${round.runsPerLane} runs per lane)`}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '0.875rem', color: '#6b7280', fontStyle: 'italic' }}>
                * Creating this schedule will generate all necessary rounds and heats. You can still modify the schedule later, but the wizard assumes a clean slate.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem' }}>
          {step > 1 ? (
            <button onClick={handleBack} className="secondary-btn" disabled={loading}>
              Back
            </button>
          ) : (
            <button onClick={onClose} className="secondary-btn" disabled={loading}>
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button onClick={handleNext} className="primary-btn">
              Next
            </button>
          ) : (
            <button onClick={handleCreate} className="primary-btn" disabled={loading}>
              {loading ? 'Generating Schedule...' : 'Generate Schedule'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
