import React from 'react';
import { useTerminology } from '../../../context/TerminologyContext';

interface WhichCarsRaceFieldsProps {
  fromBottom: boolean;
  onChooseDirection: (fromBottom: boolean) => void;
  loading?: boolean;
  labelStyle: React.CSSProperties;
  /** Colour for the helper paragraph that appears once "The slowest" is
   * chosen. Same reasoning as `HowItsRacedFields.mutedColor` — the two
   * dialogs read different CSS variables for muted text. */
  mutedColor: string;
}

/**
 * "Which cars race" — a championship round's direction, fastest or slowest
 * (the Slowest Race bracket, `Round.advancement_from_bottom`). Shared
 * between the Add Round dialog and the Round Wizard's step 2 (#943); the
 * wizard did not offer the slowest direction at all before.
 */
export const WhichCarsRaceFields: React.FC<WhichCarsRaceFieldsProps> = ({
  fromBottom,
  onChooseDirection,
  loading,
  labelStyle,
  mutedColor,
}) => {
  const { vehicles, vehiclesLower } = useTerminology();

  return (
    <div>
      <label style={labelStyle}>Which {vehiclesLower} race</label>
      <div style={{ display: 'flex', gap: '20px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            checked={!fromBottom}
            onChange={() => onChooseDirection(false)}
            disabled={loading}
          />
          <span>The fastest {vehiclesLower}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            checked={fromBottom}
            onChange={() => onChooseDirection(true)}
            disabled={loading}
          />
          <span>The slowest {vehiclesLower}</span>
        </label>
      </div>
      {fromBottom && (
        <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: mutedColor, fontStyle: 'italic' }}>
          A just-for-fun race for the slowest {vehiclesLower}. {vehicles} without a
          recorded time are left out.
        </p>
      )}
    </div>
  );
};
