import React, { useState } from 'react';
import Modal from '../Modal';
import Icon from '@mdi/react';
import { mdiFlagCheckered, mdiAccountGroup, mdiPlus, mdiChevronRight, mdiChevronLeft, mdiCheck, mdiClockOutline, mdiAlertCircle } from '@mdi/js';
import { apiClient } from '../../api/client';

interface RoundWizardProps {
  isOpen: boolean;
  onClose: () => void;
  raceId: number;
  racerCount: number;
  denCount: number;
  laneCount: number;
  onCreated: () => void;
}

interface GeneralConfig {
  type: 'PACK' | 'DEN';
  runsPerLane: number;
}

interface ChampionshipConfig {
  name: string;
  source: 'PACK' | 'DEN';
  numTopRacers: number;
  runsPerLane: number;
}

export const RoundWizard: React.FC<RoundWizardProps> = ({
  isOpen,
  onClose,
  raceId,
  racerCount,
  denCount,
  laneCount,
  onCreated,
}) => {
  const [step, setStep] = useState(1);
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    type: 'PACK',
    runsPerLane: 1,
  });
  const [championshipRounds, setChampionshipRounds] = useState<ChampionshipConfig[]>([]);
  const [includeChampionship, setIncludeChampionship] = useState(true);
  const [loading, setLoading] = useState(false);

  // Duration constants (in seconds)
  const SECONDS_PER_HEAT_RACE = 30;
  const SECONDS_PER_HEAT_RESET = 90;
  const TOTAL_SECONDS_PER_HEAT = SECONDS_PER_HEAT_RACE + SECONDS_PER_HEAT_RESET;

  const calculateBreakdown = () => {
    let generalHeats = 0;
    if (generalConfig.type === 'PACK') {
        generalHeats += racerCount * generalConfig.runsPerLane;
    } else {
        generalHeats += racerCount * generalConfig.runsPerLane;
    }

    let championshipHeats = 0;
    if (includeChampionship) {
      championshipRounds.forEach(round => {
        const multiplier = round.source === 'DEN' ? denCount : 1;
        championshipHeats += round.numTopRacers * multiplier * round.runsPerLane;
      });
    }

    return { generalHeats, championshipHeats, totalHeats: generalHeats + championshipHeats };
  };

  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes} min`;
  };

  const { generalHeats, championshipHeats, totalHeats } = calculateBreakdown();
  const estimatedSeconds = totalHeats * TOTAL_SECONDS_PER_HEAT;

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  const handleAddChampionshipRound = () => {
    if (championshipRounds.length < 2) {
      const isFirst = championshipRounds.length === 0;
      const baseTop = !isFirst ? championshipRounds[championshipRounds.length - 1].numTopRacers : 3;
      setChampionshipRounds([...championshipRounds, { 
        name: isFirst ? 'Championship Round' : 'Finals',
        source: 'PACK',
        numTopRacers: isFirst ? baseTop : Math.max(2, baseTop - 1), 
        runsPerLane: 1 
      }]);
    }
  };

  const handleRemoveChampionshipRound = (index: number) => {
    setChampionshipRounds(championshipRounds.filter((_, i) => i !== index));
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const config = {
        general_round: {
          type: generalConfig.type,
          runs_per_lane: generalConfig.runsPerLane,
        },
        championship_rounds: includeChampionship ? championshipRounds.map((r) => ({
          name: r.name,
          source: r.source,
          num_top_racers: r.numTopRacers,
          runs_per_lane: r.runsPerLane,
        })) : [],
      };
      await apiClient.post(`/races/${raceId}/wizard`, config);
      onCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create rounds via wizard:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to create rounds: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Round Creation Wizard"
      maxWidth="600px"
    >
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Sticky Estimate Bar */}
        <div style={{
          position: 'sticky',
          top: '-20px',
          zIndex: 10,
          background: '#fff9c4',
          margin: '0 -20px',
          padding: '10px 20px',
          borderBottom: '1px solid #fbc02d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.9rem',
          fontWeight: 'bold',
          color: '#827717'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Icon path={mdiClockOutline} size={0.7} />
            Estimated Race Duration: {formatDuration(estimatedSeconds)} 
            <span style={{ fontWeight: 'normal', fontSize: '0.8rem', marginLeft: '5px' }}>
              ({formatDuration(generalHeats * TOTAL_SECONDS_PER_HEAT)} Gen + {formatDuration(championshipHeats * TOTAL_SECONDS_PER_HEAT)} Champ)
            </span>
          </span>
          <span>{totalHeats} Total Heats</span>
        </div>

        {racerCount < 2 && (
          <div style={{
            background: '#fff3e0',
            border: '1px solid #ffcc80',
            color: '#e65100',
            padding: '10px 15px',
            borderRadius: '6px',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
             <Icon path={mdiAlertCircle} size={0.8} />
             <span>
               <strong>Warning:</strong> {racerCount === 0 ? 'No racers found.' : 'Not enough racers (minimum 2 required).'} 
               Schedule generation will fail until you add more racers.
             </span>
          </div>
        )}

        {/* Step Indicator */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{
              flex: 1,
              height: '4px',
              borderRadius: '2px',
              background: step >= s ? 'var(--scouting-blue)' : '#eee'
            }} />
          ))}
        </div>

        {/* Step Content */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Step 1: General Rounds</h3>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>
                Schedule the main portion of your race. Choose if you want everyone to race together or separately by den.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontWeight: 'bold' }}>Racing Format</label>
              <div style={{ display: 'flex', gap: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    aria-label="PACK"
                    checked={generalConfig.type === 'PACK'}
                    onChange={() => {
                      setGeneralConfig({ ...generalConfig, type: 'PACK' });
                      // Reset any championship rounds that were set to 'DEN' source
                      setChampionshipRounds(championshipRounds.map(r => ({
                        ...r,
                        source: 'PACK'
                      })));
                    }}
                  />
                  <span>
                    <Icon path={mdiFlagCheckered} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    PACK (One big race)
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    aria-label="DEN"
                    checked={generalConfig.type === 'DEN'}
                    onChange={() => setGeneralConfig({ ...generalConfig, type: 'DEN' })}
                  />
                  <span>
                    <Icon path={mdiAccountGroup} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    DEN (Round per den)
                  </span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontWeight: 'bold' }}>Runs per lane</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={generalConfig.runsPerLane}
                  onChange={(e) => setGeneralConfig({ ...generalConfig, runsPerLane: parseInt(e.target.value) || 1 })}
                  style={{ width: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
                <span style={{ color: '#666', fontSize: '0.85rem' }}>
                  Each racer will run in each of the {laneCount} lanes this many times.
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Step 2: Championship Rounds</h3>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>
                Schedule final races for the top performers to determine overall winners.
              </p>
              
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                  <input
                    type="checkbox"
                    checked={includeChampionship}
                    onChange={(e) => setIncludeChampionship(e.target.checked)}
                  />
                  Include Championship Round(s)
                </label>
              </div>
            </div>

            {!includeChampionship ? (
               <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', color: '#666', fontStyle: 'italic' }}>
                 Championship rounds are disabled for this race configuration.
               </div>
            ) : championshipRounds.length === 0 ? (
              <div style={{ padding: '30px', border: '2px dashed #eee', borderRadius: '12px', textAlign: 'center', background: '#fafafa' }}>
                <p style={{ color: '#888', marginBottom: '15px' }}>No championship rounds added.</p>
                <button
                  onClick={handleAddChampionshipRound}
                  className="secondary-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', margin: '0 auto' }}
                >
                  <Icon path={mdiPlus} size={0.7} /> Add Championship Round
                </button>
              </div>
            ) : (
              <>
                {championshipRounds.map((round, idx) => (
                  <div key={idx} style={{ padding: '15px', border: '1px solid #eee', borderRadius: '8px', background: '#fcfcfc', position: 'relative', marginBottom: '15px' }}>
                    <button
                      onClick={() => handleRemoveChampionshipRound(idx)}
                      style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#f44336', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Remove
                    </button>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Round Name</label>
                        <input
                          type="text"
                          value={round.name}
                          onChange={(e) => {
                            const newRounds = [...championshipRounds];
                            newRounds[idx].name = e.target.value;
                            setChampionshipRounds(newRounds);
                          }}
                          placeholder="e.g. Finals, Semi-Finals"
                          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Top performers from</label>
                          <select
                            value={round.source}
                            onChange={(e) => {
                              const newRounds = [...championshipRounds];
                              newRounds[idx].source = e.target.value as 'PACK' | 'DEN';
                              setChampionshipRounds(newRounds);
                            }}
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                          >
                            <option value="PACK">Overall (Entire Pack)</option>
                            <option value="DEN" disabled={generalConfig.type === 'PACK'}>
                              Each Den (Separately) {generalConfig.type === 'PACK' && '(Only for Den format)'}
                            </option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Number to pick</label>
                          <input
                            type="number"
                            min="1"
                            max={racerCount}
                            value={round.numTopRacers}
                            onChange={(e) => {
                              const newRounds = [...championshipRounds];
                              newRounds[idx].numTopRacers = parseInt(e.target.value) || 1;
                              setChampionshipRounds(newRounds);
                            }}
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Runs per lane</label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={round.runsPerLane}
                          onChange={(e) => {
                            const newRounds = [...championshipRounds];
                            newRounds[idx].runsPerLane = parseInt(e.target.value) || 1;
                            setChampionshipRounds(newRounds);
                          }}
                          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {championshipRounds.length < 2 && (
                  <button
                    onClick={handleAddChampionshipRound}
                    className="secondary-btn"
                    style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Icon path={mdiPlus} size={0.7} /> Add Follow-up Round
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Step 3: Preview and Finalize</h3>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>
                Confirm your schedule configuration. Rounds will be generated once you click "Create Rounds".
              </p>
            </div>

            <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: '5px' }}>Round Summary</div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span>Format:</span>
                <span style={{ fontWeight: 'bold' }}>{generalConfig.type} Racing</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span>General Round(s):</span>
                <span style={{ fontWeight: 'bold' }}>
                  {generalConfig.type === 'DEN' ? `${denCount} Den Rounds` : '1 Pack Round'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span>Championship Round(s):</span>
              <span style={{ fontWeight: 'bold' }}>{includeChampionship ? championshipRounds.length : 'Disabled'}</span>
            </div>

              <div style={{ 
                marginTop: '10px', 
                padding: '10px', 
                background: '#e3f2fd', 
                borderRadius: '4px', 
                display: 'flex', 
                justifyContent: 'space-between',
                color: 'var(--scouting-blue)',
                fontWeight: 'bold'
              }}>
                <span>Total Estimated Time:</span>
                <span>{formatDuration(estimatedSeconds)}</span>
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
              Note: Championship rounds will use placeholder entries initially. They will be updated automatically as general rounds complete.
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          <button
            onClick={step === 1 ? onClose : handleBack}
            className="secondary-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            {step === 1 ? 'Cancel' : <><Icon path={mdiChevronLeft} size={0.8} /> Back</>}
          </button>

          {step < 3 ? (
            <button
              onClick={handleNext}
              className="primary-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              Next <Icon path={mdiChevronRight} size={0.8} />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              className="primary-btn"
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#4caf50' }}
            >
              {loading ? 'Creating...' : <><Icon path={mdiCheck} size={0.8} /> Create Rounds</>}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
