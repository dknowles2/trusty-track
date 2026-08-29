/**
 * "No heats" beside a racer who is checked in and in none (#172).
 *
 * One component because the roster draws its status cell three times — the
 * den-grouped table, the plain table and the mobile card — and a badge added
 * to two of them is a badge that is missing wherever the operator happens to
 * be looking.
 */

import { rosterStatus, statusLabel, statusNotice } from '../rosterStatus';

type Props = {
  racer: { id: number; carPassedInspection: boolean };
  scheduledRacerIds: readonly number[];
  anyHeatsScheduled: boolean;
};

export default function NoHeatsBadge({ racer, scheduledRacerIds, anyHeatsScheduled }: Props) {
  const status = rosterStatus(racer, scheduledRacerIds, anyHeatsScheduled);
  const label = statusLabel(status);
  if (!label) return null;

  return (
    <span
      data-testid={`no-heats-${racer.id}`}
      title={statusNotice(status) ?? undefined}
      style={{
        display: 'inline-block',
        marginLeft: '6px',
        padding: '2px 8px',
        borderRadius: '20px',
        background: 'var(--warning-strong-bg-color)',
        border: '1px solid var(--warning-strong-border-color)',
        color: 'var(--warning-strong-color)',
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
