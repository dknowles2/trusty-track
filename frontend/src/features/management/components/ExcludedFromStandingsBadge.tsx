/**
 * "Racing, not ranked" beside a flagged racer's roster row (#548).
 *
 * A flagged car needs to look flagged, or the operator will assume the app
 * has lost it — the issue's own "saying it out loud" rule, the same
 * reasoning `NoHeatsBadge` already follows. One component for the same
 * reason that one is: the roster draws its status cell three times — the
 * racing-group-grouped table, the plain table and the mobile card.
 */

type Props = {
  racer: { id: number; excludedFromStandings: boolean };
};

export default function ExcludedFromStandingsBadge({ racer }: Props) {
  if (!racer.excludedFromStandings) return null;

  return (
    <span
      data-testid={`excluded-from-standings-${racer.id}`}
      title="Races, but is left out of the standings, advancement and awards."
      style={{
        display: 'inline-block',
        marginLeft: '6px',
        padding: '2px 8px',
        borderRadius: '20px',
        background: 'var(--info-notice-bg-color)',
        border: '1px solid var(--scouting-blue)',
        color: 'var(--scouting-blue)',
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
      }}
    >
      Not ranked
    </span>
  );
}
