/**
 * The "Edit race" button, shared by the Roster and Race Control headers
 * (#1085).
 *
 * The two pages had grown their own copy — `4px 10px` padding, icon size
 * `0.6`, `5px` gap on Roster; `6px 12px`, `0.7`, `6px` on Control — written
 * six weeks apart (#949 for Roster's header, #589 for Control's) and never
 * compared side by side. Switching tabs made the header visibly resize.
 * Control's dimensions win: they match the tab buttons beside them and are
 * the more comfortable click target. One component means the two pages
 * cannot drift again; each keeps its own `data-testid` (`edit-race-btn` on
 * Roster, `race-control-edit-race` on Control), since `terminology.spec.ts`
 * and `race-day.spec.ts` pin both.
 */

import { Icon } from '@mdi/react';
import { mdiPencil } from '@mdi/js';

type Props = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  'data-testid': string;
};

export default function EditRaceButton({ onClick, disabled, title, 'data-testid': testId }: Props) {
  return (
    <button
      onClick={onClick}
      className="secondary-btn"
      disabled={disabled}
      title={title}
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        fontSize: '0.85rem',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon path={mdiPencil} size={0.7} /> Edit race
    </button>
  );
}
