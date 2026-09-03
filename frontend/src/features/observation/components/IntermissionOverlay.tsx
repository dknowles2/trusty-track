/**
 * The break screen (#592) — a prominent countdown over a faint preview of
 * what runs next, so a room that has wandered off to the snack table still
 * knows roughly when to come back and for what.
 *
 * Full-bleed, like the results overlay and projector mode: this is for a
 * screen across a room, not a laptop. Driven entirely from props — the
 * countdown maths live in `features/racing/intermission.ts`, which this
 * calls on every render so a parent re-rendering once a second (its own
 * `setInterval`, the same shape `IntermissionControl` uses) is what makes
 * the number move. Nothing here owns a timer of its own.
 */

import { Icon } from '@mdi/react';
import { mdiCoffee } from '@mdi/js';
import { formatCountdown, liveRemainingSeconds, type IntermissionData } from '../../racing/intermission';

interface PreviewRacer {
  readonly lane: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly carNumber?: number | null;
}

interface IntermissionOverlayProps {
  intermission: IntermissionData;
  /** Who races next, for the faint preview — omitted (or empty) renders no
   * preview rather than an empty box, the same "nothing to show" rule the
   * slideshow follows. */
  nextUpRacers?: readonly PreviewRacer[];
  nextUpInfo?: string | null;
  /** For the vehicle word ("Car #7" vs. "Rocket #7"), resolved by the
   * caller — this component holds no terminology context of its own. */
  vehicleLabel?: string;
}

export default function IntermissionOverlay({
  intermission,
  nextUpRacers = [],
  nextUpInfo,
  vehicleLabel = 'Car',
}: IntermissionOverlayProps) {
  const remaining = liveRemainingSeconds(intermission, new Date());

  return (
    <div
      data-testid="intermission-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--display-bg-color)',
        color: 'var(--display-text-color)',
      }}
    >
      {/* The next heat, faint behind the countdown — a room that wandered
          off still sees roughly what is coming, without it competing with
          the number that actually matters right now. */}
      {nextUpRacers.length > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.12,
            gap: '2vmin',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', gap: '4vmin', flexWrap: 'wrap', justifyContent: 'center' }}>
            {nextUpRacers.map((r) => (
              <div key={r.lane} style={{ fontSize: '4vmin', fontWeight: 'bold', textAlign: 'center' }}>
                <div>{r.firstName} {r.lastName}</div>
                {r.carNumber != null && (
                  <div style={{ fontSize: '2.5vmin' }}>{vehicleLabel} #{r.carNumber}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Icon path={mdiCoffee} size={4} color="var(--display-accent-color)" />

      <div
        data-testid="intermission-label"
        style={{ fontSize: '4vmin', fontWeight: 'bold', marginTop: '2vmin', textAlign: 'center' }}
      >
        {intermission.label || 'Intermission'}
      </div>

      <div
        data-testid="intermission-overlay-countdown"
        style={{
          fontFamily: 'monospace',
          fontSize: '16vmin',
          fontWeight: 'bold',
          lineHeight: 1,
          marginTop: '2vmin',
          color: 'var(--display-accent-color)',
        }}
      >
        {formatCountdown(remaining)}
      </div>

      {intermission.paused && (
        <div style={{ fontSize: '3vmin', fontWeight: 'bold', marginTop: '1vmin', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Paused
        </div>
      )}

      {nextUpInfo && (
        <div style={{ fontSize: '2.5vmin', color: 'var(--display-text-muted-color)', marginTop: '3vmin' }}>
          Up next: {nextUpInfo}
        </div>
      )}
    </div>
  );
}
