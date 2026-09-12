import React from 'react';
import { Icon } from '@mdi/react';
import { mdiFlagCheckered, mdiAccountGroup } from '@mdi/js';
import { useTerminology } from '../../../context/TerminologyContext';

interface FormatFieldsProps {
  type: 'ALL' | 'EACH_GROUP';
  onChooseType: (type: 'ALL' | 'EACH_GROUP') => void;
  racingGroupCount: number;
  loading?: boolean;
  labelStyle: React.CSSProperties;
  /** Colour for the "Will create N rounds" helper paragraph. Same reasoning
   * as `HowItsRacedFields.mutedColor` — the two dialogs read different CSS
   * variables for muted text. */
  mutedColor: string;
}

/**
 * "Format" — whether the qualifying round races everyone together or splits
 * by racing group (`Round.advancement_source`'s `ALL`/`EACH_GROUP`
 * vocabulary, reused here for a general round's own `type`). Shared between
 * the Add Round dialog and the Round Wizard's step 1 (#988) — the wizard
 * used to render its own clickable-card version of this control under the
 * label "Qualifying Round Type", which is what let the two drift.
 *
 * Only meaningful alongside "Everyone races in every lane": an elimination
 * or balanced round is always the whole organization, so the caller hides
 * this fieldset for the other two `HowItsRacedFields` styles rather than
 * this component doing so itself.
 */
export const FormatFields: React.FC<FormatFieldsProps> = ({
  type,
  onChooseType,
  racingGroupCount,
  loading,
  labelStyle,
  mutedColor,
}) => {
  const { group, groupLower, org } = useTerminology();

  return (
    <div>
      <label style={labelStyle}>Format</label>
      <div style={{ display: 'flex', gap: '20px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            checked={type === 'ALL'}
            onChange={() => onChooseType('ALL')}
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
            checked={type === 'EACH_GROUP'}
            onChange={() => onChooseType('EACH_GROUP')}
            disabled={loading}
          />
          <span>
            <Icon path={mdiAccountGroup} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            By {group}
          </span>
        </label>
      </div>
      {type === 'EACH_GROUP' && (
        <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: mutedColor, fontStyle: 'italic' }}>
          Will create {racingGroupCount} rounds (one per {groupLower}).
        </p>
      )}
    </div>
  );
};
