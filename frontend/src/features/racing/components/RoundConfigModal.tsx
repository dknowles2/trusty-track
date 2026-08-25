import React, { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { Icon } from '@mdi/react';
import { mdiFlagCheckered, mdiAccountGroup, mdiInformation } from '@mdi/js';

interface RoundConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: {
    name: string;
    schedulingStrategy: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    advancementFromBottom?: boolean;
    eliminationLosses?: number;
    balancedPhases?: number;
    runsPerLane: number;
    generalType?: string;
  }) => Promise<void>;
  racerCount: number;
  denCount: number;
  laneCount: number;
  championshipTrophies: number;
  hasGeneralRound: boolean;
  /** The latest championship round, when one exists — what a new round can
   * chain from ("top ten, then top three"). Null before any exist. */
  lastChampionshipRound?: { id: number; name: string | null } | null;
}

export const RoundConfigModal: React.FC<RoundConfigModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  racerCount,
  denCount,
  laneCount,
  championshipTrophies,
  hasGeneralRound,
  lastChampionshipRound
}) => {
  const [type, setType] = useState<'GENERAL' | 'CHAMPIONSHIP'>('GENERAL');
  const [generalType, setGeneralType] = useState<'PACK' | 'DEN'>('PACK');
  const [raceStyle, setRaceStyle] = useState<'PPC' | 'ELIMINATION' | 'BALANCED'>('PPC');
  const [eliminationLosses, setEliminationLosses] = useState(3);
  const [balancedPhases, setBalancedPhases] = useState(Math.max(1, laneCount));
  const [name, setName] = useState('');
  const [source, setSource] = useState<'PACK' | 'DEN' | 'PREVIOUS'>('PACK');
  const [numTopRacers, setNumTopRacers] = useState(championshipTrophies);
  const [fromBottom, setFromBottom] = useState(false);
  const [runsPerLane, setRunsPerLane] = useState(1);
  const [loading, setLoading] = useState(false);

  /** Switch tab, and give the round the default name for its kind.
   *
   * Done here rather than in an effect watching `type`: the name follows the
   * tab the operator clicked, so the click is where it belongs. An effect had
   * to run after the render that changed the tab, which is a second render to
   * say something already known.
   */
  const chooseType = (next: 'GENERAL' | 'CHAMPIONSHIP') => {
    setType(next);
    setName(next === 'CHAMPIONSHIP' ? (fromBottom ? 'Slowest Race' : 'Championship Round') : '');
  };

  /** Flip the direction, and swap the default name along with it — but only
   * if the operator has not typed their own. */
  const chooseDirection = (nextFromBottom: boolean) => {
    setFromBottom(nextFromBottom);
    if (name === '' || name === 'Championship Round' || name === 'Slowest Race') {
      setName(nextFromBottom ? 'Slowest Race' : 'Championship Round');
    }
  };

  /** Same rule for the general round's race style. */
  const chooseStyle = (next: 'PPC' | 'ELIMINATION' | 'BALANCED') => {
    setRaceStyle(next);
    if (name === '' || name === 'Elimination Round' || name === 'Balanced Round') {
      setName(
        next === 'ELIMINATION' ? 'Elimination Round'
        : next === 'BALANCED' ? 'Balanced Round'
        : ''
      );
    }
  };

  // A championship round needs a general round to draw its field from. If the
  // last one is deleted while this is open, the choice is no longer available
  // — derived rather than corrected afterwards, so there is never a render in
  // which the modal offers something impossible.
  const effectiveType = hasGeneralRound ? type : 'GENERAL';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const isElimination = effectiveType === 'GENERAL' && raceStyle === 'ELIMINATION';
      const isBalanced = effectiveType === 'GENERAL' && raceStyle === 'BALANCED';
      await onSubmit({
        name,
        schedulingStrategy: isElimination ? 'ELIMINATION' : isBalanced ? 'BALANCED' : 'PPC',
        advancementSource:
          effectiveType === 'CHAMPIONSHIP'
            ? source === 'PREVIOUS' && lastChampionshipRound
              ? `ROUND:${lastChampionshipRound.id}`
              : source
            : undefined,
        advancementNumRacers: effectiveType === 'CHAMPIONSHIP' ? numTopRacers : undefined,
        advancementFromBottom: effectiveType === 'CHAMPIONSHIP' ? fromBottom : undefined,
        eliminationLosses: isElimination ? eliminationLosses : undefined,
        balancedPhases: isBalanced ? balancedPhases : undefined,
        runsPerLane,
        generalType: effectiveType === 'GENERAL' && !isElimination && !isBalanced ? generalType : undefined
      });
      onClose();
    } catch (error) {
      console.error('Failed to create round:', error);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold',
    fontSize: '0.9rem',
    color: '#333'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '1rem'
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px',
    textAlign: 'center',
    cursor: 'pointer',
    borderBottom: active ? '3px solid var(--scouting-blue)' : '3px solid transparent',
    fontWeight: active ? 'bold' : 'normal',
    color: active ? 'var(--scouting-blue)' : '#666',
    transition: 'all 0.2s',
    background: active ? '#f0f7ff' : 'none'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Round" maxWidth="500px">
      <form onSubmit={handleSubmit}>
        {/* Type Tabs */}
        <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid #eee' }}>
          <div style={tabStyle(effectiveType === 'GENERAL')} onClick={() => chooseType('GENERAL')}>
            General Round
          </div>
          <div
            style={{
              ...tabStyle(effectiveType === 'CHAMPIONSHIP'),
              opacity: hasGeneralRound ? 1 : 0.5,
              cursor: hasGeneralRound ? 'pointer' : 'not-allowed'
            }}
            onClick={() => {
              if (hasGeneralRound) {
                chooseType('CHAMPIONSHIP');
              }
            }}
            title={!hasGeneralRound ? "Schedule at least one general round first" : ""}
          >
            Championship Round
          </div>
        </div>

        {!hasGeneralRound && effectiveType === 'CHAMPIONSHIP' && (
           <div style={{ padding: '10px', background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
             <Icon path={mdiInformation} size={0.7} color="#f57c00" />
             Championship rounds require an existing general round as a source.
           </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '25px' }}>
          {/* Round Name */}
          <div>
            <label htmlFor="roundName" style={labelStyle}>Round Name</label>
            <input
              id="roundName"
              type="text"
              placeholder={type === 'GENERAL' ? "e.g. Quality Round" : "e.g. Finals"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          {type === 'GENERAL' ? (
            <>
              {/* How the round is raced. */}
              <div>
                <label style={labelStyle}>How it&apos;s raced</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={raceStyle === 'PPC'}
                      onChange={() => chooseStyle('PPC')}
                      disabled={loading}
                    />
                    <span>Everyone races in every lane</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={raceStyle === 'ELIMINATION'}
                      onChange={() => chooseStyle('ELIMINATION')}
                      disabled={loading}
                    />
                    <span>Elimination — lose too many heats and you&apos;re out</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={raceStyle === 'BALANCED'}
                      onChange={() => chooseStyle('BALANCED')}
                      disabled={loading}
                    />
                    <span>Balanced — each round of heats matches cars doing about as well</span>
                  </label>
                </div>
                {raceStyle === 'BALANCED' && (
                  <div style={{ marginTop: '12px' }}>
                    <label htmlFor="balancedPhases" style={labelStyle}>Times each car races</label>
                    <input
                      id="balancedPhases"
                      type="number"
                      min={1}
                      max={8}
                      value={balancedPhases}
                      onChange={(e) => setBalancedPhases(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ ...inputStyle, width: '50%' }}
                      disabled={loading}
                    />
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                      The first heats are drawn at random; after that, winners
                      race winners — so more children get a heat they can win.
                      Times and points still count toward the standings.
                    </p>
                  </div>
                )}
                {raceStyle === 'ELIMINATION' && (
                  <div style={{ marginTop: '12px' }}>
                    <label htmlFor="eliminationLosses" style={labelStyle}>Losses before a car is out</label>
                    <input
                      id="eliminationLosses"
                      type="number"
                      min={1}
                      max={10}
                      value={eliminationLosses}
                      onChange={(e) => setEliminationLosses(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ ...inputStyle, width: '50%' }}
                      disabled={loading}
                    />
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                      New heats appear after each round of racing, matching cars
                      with the same record. The last car left wins.
                    </p>
                  </div>
                )}
              </div>

              {raceStyle !== 'PPC' ? null : (
              <div>
                <label style={labelStyle}>Format</label>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={generalType === 'PACK'}
                      onChange={() => setGeneralType('PACK')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiFlagCheckered} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      PACK
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={generalType === 'DEN'}
                      onChange={() => setGeneralType('DEN')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiAccountGroup} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      DEN
                    </span>
                  </label>
                </div>
                {generalType === 'DEN' && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                    Will create {denCount} rounds (one per den).
                  </p>
                )}
              </div>
              )}
            </>
          ) : (
            <>
              {/* Which end of the standings the field comes from. */}
              <div>
                <label style={labelStyle}>Which cars race</label>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={!fromBottom}
                      onChange={() => chooseDirection(false)}
                      disabled={loading}
                    />
                    <span>The fastest cars</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={fromBottom}
                      onChange={() => chooseDirection(true)}
                      disabled={loading}
                    />
                    <span>The slowest cars</span>
                  </label>
                </div>
                {fromBottom && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                    A just-for-fun race for the slowest cars. Cars without a
                    recorded time are left out.
                  </p>
                )}
              </div>

              {/* Championship Config */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div>
                  <label style={labelStyle}>{fromBottom ? 'Slowest cars from' : 'Top performers from'}</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'PACK' | 'DEN' | 'PREVIOUS')}
                    style={inputStyle}
                    disabled={loading}
                  >
                    <option value="PACK">PACK (Overall)</option>
                    <option value="DEN">DEN (Each Den)</option>
                    {lastChampionshipRound && (
                      <option value="PREVIOUS">
                        {lastChampionshipRound.name || 'Previous championship round'}
                      </option>
                    )}
                  </select>
                </div>
                <div>
                  <label htmlFor="numToPick" style={labelStyle}>Number to pick</label>
                  <input
                    id="numToPick"
                    type="number"
                    min={fromBottom ? 1 : championshipTrophies}
                    max={racerCount}
                    value={numTopRacers}
                    onChange={(e) =>
                      setNumTopRacers(
                        Math.max(fromBottom ? 1 : championshipTrophies, parseInt(e.target.value) || 1)
                      )
                    }
                    style={inputStyle}
                    disabled={loading}
                  />
                </div>
              </div>
              {/* The trophy minimum is about handing out championship trophies,
                  which a slowest race does not do. */}
              {!fromBottom && (
                <div style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Icon path={mdiInformation} size={0.6} color="#666" />
                  Minimum pick count ({championshipTrophies}) enforced by trophy config.
                </div>
              )}
            </>
          )}

          {/* Runs Per Lane — only for PPC. The growing styles have their own
              count: losses for elimination, phases for balanced. */}
          {!(type === 'GENERAL' && raceStyle !== 'PPC') && (
          <div style={{ width: '50%' }}>
            <label style={labelStyle}>Runs per lane</label>
            <input
              type="number"
              min="1"
              max="10"
              value={runsPerLane}
              onChange={(e) => setRunsPerLane(parseInt(e.target.value) || 1)}
              style={inputStyle}
              disabled={loading}
            />
          </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          <button
            type="button"
            onClick={onClose}
            className="secondary-btn"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            disabled={loading || racerCount < 2}
          >
            {loading ? 'Creating...' : 'Create Round(s) & Generate Heats'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
