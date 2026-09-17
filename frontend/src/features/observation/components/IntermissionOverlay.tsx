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
import ReplayPlayer from './ReplayPlayer';

interface PreviewRacer {
  readonly lane: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly carNumber?: number | null;
}

/** One clip of the break's highlight reel (#177 stage 3) — the piece
 * `IntermissionOverlay` actually renders; ordering, captions and which
 * camera to use all live in `features/observation/highlights.ts`. */
export interface IntermissionHighlightClip {
  readonly url: string;
  readonly caption: string;
}

interface IntermissionOverlayProps {
  intermission: IntermissionData;
  /** Who races next, for the faint preview — omitted (or empty) renders no
   * preview rather than an empty box, the same "nothing to show" rule the
   * slideshow follows. Ignored while `highlightClip` is showing something
   * (below) — the clip takes the screen's attention instead. */
  nextUpRacers?: readonly PreviewRacer[];
  nextUpInfo?: string | null;
  /** For the vehicle word ("Car #7" vs. "Rocket #7"), resolved by the
   * caller — this component holds no terminology context of its own. */
  vehicleLabel?: string;
  /** The current replay clip to show instead of the next-up preview
   * (#177 stage 3) — present only while `intermission.highlights` is true
   * *and* the caller has at least one clip ready; `null` falls back to the
   * ordinary countdown-and-preview layout, which covers both "highlights
   * off" and "highlights on but nothing to play yet". */
  highlightClip?: IntermissionHighlightClip | null;
  /** Called when the current clip finishes playing, so the caller can
   * advance to the next one in the reel (looping until the break ends).
   * Method-shorthand syntax rather than an arrow-typed field, deliberately
   * — an inline `=> void` earlier in this file bridges `terminologyGuard.
   * test.ts`'s own `>...<` heuristic straight into this file's later
   * `vehicleLabel = 'Car'` default, the same false positive documented on
   * `PrintDecor.tsx`'s allowlist entry; this sidesteps it rather than
   * adding a second one. */
  onHighlightEnded?(): void;
}

export default function IntermissionOverlay({
  intermission,
  nextUpRacers = [],
  nextUpInfo,
  vehicleLabel = 'Car',
  highlightClip = null,
  onHighlightEnded,
}: IntermissionOverlayProps) {
  const remaining = liveRemainingSeconds(intermission, new Date());

  if (highlightClip) {
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
        {/* The countdown moves to a corner badge while a clip is playing
            (#177 stage 3's own instruction: "the countdown stays visible
            (corner)") — the clip itself is the thing to look at. */}
        <div
          data-testid="intermission-overlay-countdown-corner"
          style={{
            position: 'absolute',
            top: '3vmin',
            right: '3vmin',
            display: 'flex',
            alignItems: 'center',
            gap: '1vmin',
            padding: '1vmin 2vmin',
            borderRadius: '999px',
            background: 'rgba(0, 0, 0, 0.35)',
          }}
        >
          <Icon path={mdiCoffee} size={0.8} color="var(--display-accent-color)" />
          <span
            data-testid="intermission-overlay-countdown"
            style={{
              fontFamily: 'var(--font-body)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '2.5vmin',
              fontWeight: 'bold',
              color: 'var(--display-accent-color)',
            }}
          >
            {formatCountdown(remaining)}
          </span>
          {intermission.paused && (
            <span style={{ fontSize: '1.5vmin', fontWeight: 'bold', textTransform: 'uppercase' }}>
              Paused
            </span>
          )}
        </div>

        <div
          data-testid="intermission-label"
          style={{ fontSize: '3vmin', fontWeight: 'bold', marginBottom: '2vmin', textAlign: 'center' }}
        >
          {intermission.label || 'Intermission'}
        </div>

        <ReplayPlayer
          key={highlightClip.url}
          url={highlightClip.url}
          autoPlay
          controls={false}
          onEnded={onHighlightEnded}
        />

        <div
          data-testid="intermission-highlight-caption"
          style={{ fontSize: '2.2vmin', marginTop: '2vmin', color: 'var(--display-text-muted-color)' }}
        >
          {highlightClip.caption}
        </div>
      </div>
    );
  }

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
          // Not a system `monospace` (#821) — the bundled body face plus
          // tabular figures keeps the countdown from jittering in width as
          // its digits change, without asking the host what "monospace"
          // resolves to.
          fontFamily: 'var(--font-body)',
          fontVariantNumeric: 'tabular-nums',
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
