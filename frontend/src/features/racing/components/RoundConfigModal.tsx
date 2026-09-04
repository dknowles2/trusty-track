import React, { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { Icon } from '@mdi/react';
import { mdiFlagCheckered, mdiAccountGroup, mdiInformation } from '@mdi/js';
import { useTerminology } from '../../../context/TerminologyContext';

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
    pickFieldByHand?: boolean;
  }) => Promise<void>;
  racerCount: number;
  racingGroupCount: number;
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
  racingGroupCount,
  laneCount,
  championshipTrophies,
  hasGeneralRound,
  lastChampionshipRound
}) => {
  const { group, groupLower, org, vehicles, vehicleLower, vehiclesLower } = useTerminology();
  const [type, setType] = useState<'GENERAL' | 'CHAMPIONSHIP'>('GENERAL');
  const [generalType, setGeneralType] = useState<'ALL' | 'EACH_GROUP'>('ALL');
  const [raceStyle, setRaceStyle] = useState<'PPC' | 'ELIMINATION' | 'BALANCED'>('PPC');
  const [eliminationLosses, setEliminationLosses] = useState(3);
  const [balancedPhases, setBalancedPhases] = useState(Math.max(1, laneCount));
  const [name, setName] = useState('');
  const [source, setSource] = useState<'ALL' | 'EACH_GROUP' | 'PREVIOUS'>('ALL');
  const [numTopRacers, setNumTopRacers] = useState(championshipTrophies);
  const [fromBottom, setFromBottom] = useState(false);
  const [pickFieldByHand, setPickFieldByHand] = useState(false);
  const [runsPerLane, setRunsPerLane] = useState(1);
  const [loading, setLoading] = useState(false);

  /** The modal stays mounted across a close/reopen (it is the parent that
   * toggles `isOpen`), so nothing above resets on its own. A general round
   * can be deleted while it is closed, and without this a `type` of
   * CHAMPIONSHIP chosen last time it was open would survive into a reopen
   * where `hasGeneralRound` is now false — briefly true (the tab reads
   * `effectiveType`, so it never *shows* CHAMPIONSHIP), but the moment an
   * operator schedules a new general round and reopens, the stale tab
   * silently comes back. Reset on the open transition, not on every render
   * while open, or a mid-session change to `hasGeneralRound` would bounce an
   * operator mid-edit back to General. */
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setType('GENERAL');
      setName('');
      setPickFieldByHand(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

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
        generalType: effectiveType === 'GENERAL' && !isElimination && !isBalanced ? generalType : undefined,
        pickFieldByHand: effectiveType === 'CHAMPIONSHIP' ? pickFieldByHand : undefined
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
    color: 'var(--text-color)'
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px',
    textAlign: 'center',
    cursor: 'pointer',
    borderBottom: active ? '3px solid var(--scouting-blue)' : '3px solid transparent',
    fontWeight: active ? 'bold' : 'normal',
    color: active ? 'var(--scouting-blue)' : 'var(--text-muted-color)',
    transition: 'all 0.2s',
    background: active ? 'var(--surface-hover-color)' : 'none'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Round" maxWidth="500px">
      <form onSubmit={handleSubmit}>
        {/* Type Tabs */}
        <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid var(--divider-color)' }}>
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

        {/* This reads the raw `type`, not `effectiveType` — the point of the
            banner is to explain why the operator was bounced back to the
            General tab. `effectiveType` is General exactly when this
            condition would need to hold, so testing it here made the banner
            unreachable. */}
        {!hasGeneralRound && type === 'CHAMPIONSHIP' && (
           <div style={{ padding: '10px', background: 'var(--caution-bg-color)', border: '1px solid var(--caution-border-color)', borderRadius: '4px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
             <Icon path={mdiInformation} size={0.7} color="var(--caution-icon-color)" />
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
              placeholder={effectiveType === 'GENERAL' ? "e.g. Quality Round" : "e.g. Finals"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-control"
              disabled={loading}
            />
          </div>

          {effectiveType === 'GENERAL' ? (
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
                    <span>Balanced — each round of heats matches {vehiclesLower} doing about as well</span>
                  </label>
                </div>
                {raceStyle === 'BALANCED' && (
                  <div style={{ marginTop: '12px' }}>
                    <label htmlFor="balancedPhases" style={labelStyle}>Times each {vehicleLower} races</label>
                    <input
                      id="balancedPhases"
                      type="number"
                      min={1}
                      max={8}
                      value={balancedPhases}
                      onChange={(e) => setBalancedPhases(Math.max(1, parseInt(e.target.value) || 1))}
                      className="form-control"
                      style={{ width: '50%' }}
                      disabled={loading}
                    />
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)', fontStyle: 'italic' }}>
                      The first heats are drawn at random; after that, winners
                      race winners — so more children get a heat they can win.
                      Times and points still count toward the standings.
                    </p>
                  </div>
                )}
                {raceStyle === 'ELIMINATION' && (
                  <div style={{ marginTop: '12px' }}>
                    <label htmlFor="eliminationLosses" style={labelStyle}>Losses before a {vehicleLower} is out</label>
                    <input
                      id="eliminationLosses"
                      type="number"
                      min={1}
                      max={10}
                      value={eliminationLosses}
                      onChange={(e) => setEliminationLosses(Math.max(1, parseInt(e.target.value) || 1))}
                      className="form-control"
                      style={{ width: '50%' }}
                      disabled={loading}
                    />
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)', fontStyle: 'italic' }}>
                      New heats appear after each round of racing, matching {vehiclesLower}
                      with the same record. The last {vehicleLower} left wins.
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
                      checked={generalType === 'ALL'}
                      onChange={() => setGeneralType('ALL')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiFlagCheckered} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      All {org}
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={generalType === 'EACH_GROUP'}
                      onChange={() => setGeneralType('EACH_GROUP')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiAccountGroup} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      By {group}
                    </span>
                  </label>
                </div>
                {generalType === 'EACH_GROUP' && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)', fontStyle: 'italic' }}>
                    Will create {racingGroupCount} rounds (one per {groupLower}).
                  </p>
                )}
              </div>
              )}
            </>
          ) : (
            <>
              {/* Which end of the standings the field comes from. */}
              <div>
                <label style={labelStyle}>Which {vehiclesLower} race</label>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={!fromBottom}
                      onChange={() => chooseDirection(false)}
                      disabled={loading}
                    />
                    <span>The fastest {vehiclesLower}</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={fromBottom}
                      onChange={() => chooseDirection(true)}
                      disabled={loading}
                    />
                    <span>The slowest {vehiclesLower}</span>
                  </label>
                </div>
                {fromBottom && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)', fontStyle: 'italic' }}>
                    A just-for-fun race for the slowest {vehiclesLower}. {vehicles} without a
                    recorded time are left out.
                  </p>
                )}
              </div>

              {/* Championship Config */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div>
                  <label style={labelStyle}>{fromBottom ? `Slowest ${vehiclesLower} from` : 'Top performers from'}</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'ALL' | 'EACH_GROUP' | 'PREVIOUS')}
                    className="form-control"
                    disabled={loading}
                  >
                    <option value="ALL">Overall</option>
                    <option value="EACH_GROUP">Each {group}</option>
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
                    className="form-control"
                    disabled={loading}
                  />
                </div>
              </div>
              {/* The trophy minimum is about handing out championship trophies,
                  which a slowest race does not do. */}
              {!fromBottom && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted-color)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Icon path={mdiInformation} size={0.6} color="var(--text-muted-color)" />
                  Minimum pick count ({championshipTrophies}) enforced by trophy config.
                </div>
              )}

              {/* Skips the automatic pick entirely (#711) — the round is
                  still created and scheduled the usual way, but this screen
                  hands off to the schedule's own picker for the line-up
                  itself rather than filling it from the standings above. */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={pickFieldByHand}
                  onChange={(e) => setPickFieldByHand(e.target.checked)}
                  disabled={loading}
                  style={{ marginTop: '3px' }}
                />
                <span>
                  <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>I&apos;ll choose who races myself</span>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted-color)' }}>
                    Skip the standings&apos; own pick above — right after this round is
                    created, you&apos;ll choose exactly which {vehiclesLower} are in it. You
                    can still see what the standings would have suggested when you do.
                  </p>
                </span>
              </label>
            </>
          )}

          {/* Runs Per Lane — only for PPC. The growing styles have their own
              count: losses for elimination, phases for balanced. */}
          {!(effectiveType === 'GENERAL' && raceStyle !== 'PPC') && (
          <div style={{ width: '50%' }}>
            <label style={labelStyle}>Runs per lane</label>
            <input
              type="number"
              min="1"
              max="10"
              value={runsPerLane}
              onChange={(e) => setRunsPerLane(parseInt(e.target.value) || 1)}
              className="form-control"
              disabled={loading}
            />
          </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--divider-color)', paddingTop: '20px' }}>
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
