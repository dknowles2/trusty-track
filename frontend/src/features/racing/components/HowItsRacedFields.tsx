import React from 'react';
import { useTerminology } from '../../../context/TerminologyContext';

/** The three ways a general round can be raced (`domain/scheduling.py`,
 * `domain/elimination.py`, `domain/balanced.py`; `reference/round-styles.md`
 * has the full rules). Mirrors `models.SchedulingStrategy`'s three values
 * that a *general* round may hold — a championship round is always PPC
 * (CLAUDE.md's "Ladderless elimination": "An elimination round cannot be a
 * championship round"), so this type, and the fieldset below, only ever
 * appears once per dialog, for the qualifying round. */
export type RaceStyle = 'PPC' | 'ELIMINATION' | 'BALANCED';

interface HowItsRacedFieldsProps {
  raceStyle: RaceStyle;
  onChooseStyle: (style: RaceStyle) => void;
  laneCount: number;
  loading?: boolean;
  balancedPhases: number;
  onBalancedPhasesChange: (value: number) => void;
  eliminationLosses: number;
  onEliminationLossesChange: (value: number) => void;
  /** The label's own look differs between the two dialogs (Add Round reads
   * the app's theme vars; the wizard predates theming and uses its own
   * fixed palette — see CLAUDE.md's "Not attempted here" note on the
   * inline-style migration), so the caller supplies it rather than the
   * fieldset guessing which one it is in. */
  labelStyle: React.CSSProperties;
  /** Colour for the two styles' own helper paragraphs (not the lane-count
   * warning below, which has always read a fixed colour regardless of
   * caller — see the comment beside it). */
  mutedColor: string;
}

/**
 * "How it's raced" (`RoundConfigModal`'s own name for this choice —
 * `reference/round-styles.md` calls it that too, so this is the one
 * vocabulary rather than a second one invented for extraction) — shared
 * between the Add Round dialog and the Round Wizard's step 1 (#943). The
 * wizard did not offer this choice at all before, so a pack wanting balanced
 * or elimination racing had to know to skip the recommended path.
 */
export const HowItsRacedFields: React.FC<HowItsRacedFieldsProps> = ({
  raceStyle,
  onChooseStyle,
  laneCount,
  loading,
  balancedPhases,
  onBalancedPhasesChange,
  eliminationLosses,
  onEliminationLossesChange,
  labelStyle,
  mutedColor,
}) => {
  const { vehicleLower, vehiclesLower } = useTerminology();

  return (
    <div>
      <label style={labelStyle}>How it&apos;s raced</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            checked={raceStyle === 'PPC'}
            onChange={() => onChooseStyle('PPC')}
            disabled={loading}
          />
          <span>Everyone races in every lane</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: laneCount < 2 ? 'not-allowed' : 'pointer' }}>
          <input
            type="radio"
            checked={raceStyle === 'ELIMINATION'}
            onChange={() => onChooseStyle('ELIMINATION')}
            disabled={loading || laneCount < 2}
          />
          <span>Elimination — lose too many heats and you&apos;re out</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: laneCount < 2 ? 'not-allowed' : 'pointer' }}>
          <input
            type="radio"
            checked={raceStyle === 'BALANCED'}
            onChange={() => onChooseStyle('BALANCED')}
            disabled={loading || laneCount < 2}
          />
          <span>Balanced — each round of heats matches {vehiclesLower} doing about as well</span>
        </label>
      </div>
      {laneCount < 2 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)', marginTop: '4px' }}>
          Elimination and balanced rounds require at least 2 usable lanes.
        </p>
      )}
      {raceStyle === 'BALANCED' && (
        <div style={{ marginTop: '12px' }}>
          <label htmlFor="balancedPhases" style={labelStyle}>Times each {vehicleLower} races</label>
          <input
            id="balancedPhases"
            type="number"
            min={1}
            max={8}
            value={balancedPhases}
            onChange={(e) => onBalancedPhasesChange(Math.max(1, parseInt(e.target.value) || 1))}
            className="form-control"
            style={{ width: '50%' }}
            disabled={loading}
          />
          <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: mutedColor, fontStyle: 'italic' }}>
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
            onChange={(e) => onEliminationLossesChange(Math.max(1, parseInt(e.target.value) || 1))}
            className="form-control"
            style={{ width: '50%' }}
            disabled={loading}
          />
          <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: mutedColor, fontStyle: 'italic' }}>
            New heats appear after each round of racing, matching{' '}
            {vehiclesLower} with the same record. The last {vehicleLower} left wins.
          </p>
        </div>
      )}
    </div>
  );
};
