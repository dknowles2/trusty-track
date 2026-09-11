import React from 'react';
import { useTerminology } from '../../../context/TerminologyContext';

interface PickFieldByHandCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  loading?: boolean;
  mutedColor: string;
}

/**
 * "I'll choose who races myself" (#711) — skips the automatic pick from the
 * standings, so the operator fills a championship round's line-up by hand
 * right after it is created. Shared between the Add Round dialog and the
 * Round Wizard's step 2 (#943); the wizard did not offer it at all before.
 */
export const PickFieldByHandCheckbox: React.FC<PickFieldByHandCheckboxProps> = ({
  checked,
  onChange,
  loading,
  mutedColor,
}) => {
  const { vehiclesLower } = useTerminology();

  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={loading}
        style={{ marginTop: '3px' }}
      />
      <span>
        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>I&apos;ll choose who races myself</span>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: mutedColor }}>
          Skip the standings&apos; own pick above — right after this round is
          created, you&apos;ll choose exactly which {vehiclesLower} are in it. You
          can still see what the standings would have suggested when you do.
        </p>
      </span>
    </label>
  );
};
