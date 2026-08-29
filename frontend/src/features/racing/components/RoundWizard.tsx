import React, { useState } from 'react';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { useMutation } from 'urql';
import { CREATE_ROUND_WIZARD } from '../graphql/queries';
import { ESTIMATED_HEAT_DURATION_MIN } from '../../../utils/constants';
import { minutesEstimate } from '../../../utils/duration';
import Modal from '../../../components/ui/Modal';

interface RoundWizardProps {
  isOpen: boolean;
  onClose: () => void;
  raceId: number;
  racerCount: number;
  racingGroupCount: number;
  laneCount: number;
  championshipTrophies: number;
  onCreated: () => void;
}

interface GeneralConfig {
  type: 'ALL' | 'EACH_GROUP';
  runsPerLane: number;
}

interface ChampionshipConfig {
  id: string;
  name: string;
  source: 'ALL' | 'EACH_GROUP' | 'PREVIOUS';
  numTopRacers: number;
  runsPerLane: number;
}

export const RoundWizard: React.FC<RoundWizardProps> = ({
  isOpen,
  onClose,
  raceId,
  racerCount,
  racingGroupCount,
  laneCount,
  championshipTrophies,
  onCreated,
}) => {
  const [step, setStep] = useState(1);
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    type: 'ALL',
    runsPerLane: 1,
  });
  // Opening the wizard starts it over, which is what mounting already does —
  // the caller keys this on `isOpen`, so every open is a fresh component. The
  // effect this replaces reset four pieces of state and had to list
  // `laneCount` and `championshipTrophies` as dependencies, so a lane count
  // changing underneath would silently throw away a half-filled wizard.
  const [championshipRounds, setChampionshipRounds] = useState<ChampionshipConfig[]>([{
    id: 'champ-1',
    name: 'Grand Finals',
    source: 'ALL',
    numTopRacers: Math.max(championshipTrophies, laneCount), // Default to filling a heat
    runsPerLane: 1
  }]);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlert();

  // GraphQL Mutation
  const [, createRoundWizardMutation] = useMutation(CREATE_ROUND_WIZARD);

  /** Heats a PPC round of this many racers produces, per run.
   *
   * One heat per racer, not per lane-full of them — `generate_ppc` seeds lane 1
   * with every racer, and that is what fixes the count. Dividing by the lane
   * count is the arithmetic for a scheduler that packs racers into heats, which
   * PPC deliberately is not: every racer runs in every lane, so a 19-racer
   * round on a 3-lane track is 19 heats, not 7 (#140).
   *
   * This preview is where an operator decides whether their evening fits, and
   * it feeds the run-time estimate too, so being out by a factor of the lane
   * count is out by a factor of the lane count on both numbers.
   */
  const heatsFor = (racers: number, runs: number) => racers * runs;

  const getRaceBreakdown = () => {
    const rounds: { name: string; heats: number; duration: number }[] = [];

    // General Round
    const generalHeats = heatsFor(racerCount, generalConfig.runsPerLane);
    rounds.push({
      name: `${generalConfig.type === 'ALL' ? 'All Pack' : 'Racing Group'} Round`,
      heats: generalHeats,
      duration: Math.ceil(generalHeats * ESTIMATED_HEAT_DURATION_MIN)
    });

    // Championship Rounds
    for (const round of championshipRounds) {
      let participatingRacers = 0;
      if (round.source === 'ALL' || round.source === 'PREVIOUS') {
        participatingRacers = round.numTopRacers;
      } else {
        participatingRacers = round.numTopRacers * racingGroupCount;
      }
      const roundHeats = heatsFor(participatingRacers, round.runsPerLane);
      rounds.push({
        name: round.name,
        heats: roundHeats,
        duration: Math.ceil(roundHeats * ESTIMATED_HEAT_DURATION_MIN)
      });
    }

    const totalHeats = rounds.reduce((sum, r) => sum + r.heats, 0);
    const totalDuration = rounds.reduce((sum, r) => sum + r.duration, 0);

    return { rounds, totalHeats, totalDuration };
  };

  const { rounds: breakdown, totalHeats, totalDuration } = getRaceBreakdown();

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const handleAddChampionshipRound = () => {
    setChampionshipRounds(prev => [
      ...prev,
      {
        id: `champ-${Date.now()}`,
        name: 'New Championship Round',
        source: prev.length === 0 ? 'ALL' : 'PREVIOUS',
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
    } catch (error: unknown) {
      console.error('Failed to create rounds via wizard:', error);
      showAlert(errorText(error, 'The rounds could not be created.'), "Error");
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--wizard-text-color)',
    marginBottom: '0.5rem'
  };

  const stepIndicatorStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    color: active ? 'var(--accent-blue-color)' : 'var(--wizard-icon-muted-color)',
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
    borderColor: active ? 'var(--accent-blue-color)' : 'var(--wizard-border-muted-color)',
    backgroundColor: active ? 'var(--accent-blue-bg-color)' : 'transparent',
    boxSizing: 'border-box'
  });

  const configCardStyle = (active: boolean): React.CSSProperties => ({
    border: '1px solid',
    borderRadius: '0.5rem',
    padding: '1rem',
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s',
    borderColor: active ? 'var(--selection-accent-color)' : 'var(--wizard-border-color)',
    backgroundColor: active ? 'var(--accent-blue-bg-color)' : 'transparent',
    boxSizing: 'border-box'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Race Schedule Wizard" maxWidth="650px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header Description */}
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--wizard-text-subtle-color)', fontSize: '0.875rem', marginTop: '-1rem', marginBottom: '1.5rem' }}>
            Quickly generate a complete race schedule based on your settings.
          </p>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={stepIndicatorStyle(step >= 1)}>
              <span style={stepNumberStyle(step >= 1)}>1</span>
              General Rounds
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: 'var(--wizard-border-muted-color)', margin: '0 0.5rem' }}></div>
            <div style={stepIndicatorStyle(step >= 2)}>
              <span style={stepNumberStyle(step >= 2)}>2</span>
              Championships
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: 'var(--wizard-border-muted-color)', margin: '0 0.5rem' }}></div>
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
                    style={configCardStyle(generalConfig.type === 'ALL')}
                    onClick={() => setGeneralConfig({ ...generalConfig, type: 'ALL' })}
                  >
                    <div style={{ fontWeight: 500 }}>All Pack</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>Every racer races against everyone else in the pack.</div>
                  </div>
                  <div
                    style={configCardStyle(generalConfig.type === 'EACH_GROUP')}
                    onClick={() => setGeneralConfig({ ...generalConfig, type: 'EACH_GROUP' })}
                  >
                    <div style={{ fontWeight: 500 }}>By Racing Group</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>Racers only race against others in their own racing group initially.</div>
                  </div>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Runs Per Lane</label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  className="form-control"
                  value={generalConfig.runsPerLane}
                  onChange={(e) => setGeneralConfig({ ...generalConfig, runsPerLane: parseInt(e.target.value) || 1 })}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>How many times does each racer run in each lane? (Standard is 1)</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--wizard-heading-color)', margin: 0 }}>Championship Rounds</h3>
                <button onClick={handleAddChampionshipRound} style={{ background: 'none', color: 'var(--accent-blue-color)', fontSize: '0.875rem', padding: 0 }}>+ Add Round</button>
              </div>

              {championshipRounds.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--wizard-text-muted-color)', backgroundColor: 'var(--wizard-surface-alt-color)', borderRadius: '0.5rem', border: '1px dashed var(--wizard-border-muted-color)' }}>
                  No championship rounds configured.
                </div>
              )}

              {championshipRounds.map((round, idx) => (
                <div key={round.id} style={{ position: 'relative', border: '1px solid var(--wizard-border-color)', borderRadius: '0.5rem', padding: '1rem', backgroundColor: 'var(--wizard-surface-alt-color)' }}>
                  <button
                    onClick={() => handleRemoveChampionshipRound(round.id)}
                    style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', color: 'var(--wizard-icon-muted-color)', fontSize: '1.25rem', padding: '0 4px' }}
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
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
                        value={round.name}
                        onChange={(e) => updateChampionshipRound(round.id, { name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Who advances</label>
                      {idx === 0 ? (
                        <select
                          className="form-control"
                          style={{ fontSize: '0.875rem' }}
                          value={round.source}
                          onChange={(e) => updateChampionshipRound(round.id, { source: e.target.value as 'ALL' | 'EACH_GROUP' })}
                        >
                          <option value="ALL">Top Overall (Pack)</option>
                          <option value="EACH_GROUP">Top per Racing Group</option>
                        </select>
                      ) : (
                        <div
                          className="form-control"
                          style={{ fontSize: '0.875rem', backgroundColor: 'var(--wizard-chip-bg-color)', color: 'var(--wizard-text-muted-color)', display: 'flex', alignItems: 'center' }}
                        >
                          Previous Championship Round
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>
                        {round.source === 'ALL' ? 'Number of Finalists' : 'Advancing per Racing Group'}
                      </label>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
                        value={round.numTopRacers}
                        onChange={(e) => updateChampionshipRound(round.id, { numTopRacers: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Runs Per Lane</label>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
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
              <div style={{ backgroundColor: 'var(--accent-blue-bg-color)', padding: '1rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem', marginRight: '0.75rem' }}>⏱️</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--accent-blue-emphasis-color)' }}>Estimated Grand Total: {minutesEstimate(totalDuration)}</div>
                  <div style={{ color: 'var(--accent-blue-strong-color)', fontSize: '0.875rem' }}>Total Heats: {totalHeats}</div>
                </div>
              </div>

              <div style={{ border: '1px solid var(--wizard-border-color)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                {breakdown.map((roundInfo, idx) => (
                  <div key={idx} style={{
                    padding: '1rem',
                    borderBottom: idx === breakdown.length - 1 ? 'none' : '1px solid var(--wizard-border-color)',
                    backgroundColor: idx % 2 === 0 ? 'var(--surface-color)' : 'var(--wizard-surface-alt-color)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 style={{ fontWeight: 'bold', color: 'var(--wizard-heading-color)', margin: 0 }}>{idx + 1}. {roundInfo.name}</h4>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: 'var(--wizard-heading-color)', fontSize: '0.875rem' }}>{minutesEstimate(roundInfo.duration)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)' }}>{roundInfo.heats} {roundInfo.heats === 1 ? 'heat' : 'heats'}</div>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--wizard-text-subtle-color)', margin: '0.25rem 0 0 0' }}>
                      {idx === 0 ? (
                        generalConfig.type === 'ALL' ? 'All racers compete against each other.' : 'Racers compete within their racing groups.'
                      ) : (
                        `Advances top ${championshipRounds[idx-1].numTopRacers} racers ${
                          championshipRounds[idx-1].source === 'EACH_GROUP' ? ' from each racing group' :
                          championshipRounds[idx-1].source === 'PREVIOUS' ? ` from ${championshipRounds[idx-2]?.name || 'previous round'}` :
                          ' overall'
                        }.`
                      )}
                      {' '}{(idx === 0 ? generalConfig.runsPerLane : championshipRounds[idx-1].runsPerLane) > 1 && `(${(idx === 0 ? generalConfig.runsPerLane : championshipRounds[idx-1].runsPerLane)} runs per lane)`}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', fontStyle: 'italic' }}>
                * Creating this schedule will generate all necessary rounds and heats. You can still modify the schedule later, but the wizard assumes a clean slate.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--wizard-border-color)', paddingTop: '1.5rem' }}>
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
