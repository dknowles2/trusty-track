/**
 * The two treatments a display gives its own name (#495), rendered once so
 * every screen a display can end up on gets both (#519).
 *
 * `identifyOverlay.ts` holds the rule; this is the rendering plus the two
 * `useState`/`setTimeout` pairs that used to be a private copy inside
 * `Observation.tsx` alone. `AwardCeremony.tsx` is its own route — a screen
 * assigned the ceremony navigates away from Observation and holds its own
 * `displayAssignment` subscription to keep its presence (#174) — so without a
 * shared place for this, Identify could only ever reach one of the two pages
 * a display shows. #48's standing lesson: a rule that depends on each page
 * remembering reaches only some of them.
 */

import { useEffect, useState } from 'react';
import { observeIdentify, type SeenIdentifySeq } from './identifyOverlay';
import { useChrome } from '../../context/ChromeContext';

export interface IdentifyAssignment {
  readonly name?: string | null;
  readonly identifySeq?: number | null;
}

interface Props {
  /** The same `displayAssignment` payload both pages already subscribe to. */
  assignment: IdentifyAssignment | null;
  /**
   * True when the caller has a spot for this badge in its own layout flow
   * (#954) — the standard, non-projector Live view, which keeps a status row
   * (the timer pill, then **Launch Projector Mode**) the badge can join on
   * the left rather than float over. Every other caller — the five
   * chrome-hidden views this page also renders, and `AwardCeremony`, which
   * paints itself above the navigation at its own z-index rather than
   * hiding it via `ChromeContext` — is a genuinely full-screen surface with
   * no row to join and nothing in that corner to collide with, so those
   * keep the fixed-corner treatment untouched.
   */
  inline?: boolean;
}

/**
 * Renders nothing until this display has a name to show. Place it once, near
 * the root of whatever full-screen surface the page renders — the flash is
 * always `position: fixed`, and so is the connect badge unless the caller
 * passes `inline`.
 */
export default function IdentifyPresence({ assignment, inline = false }: Props) {
  // Whether the app's own header is on screen (#175). A projector has none —
  // `chromeHidden` is true — so the badge is free to sit at the very corner.
  // Everywhere else `Navigation`'s bar occupies that corner already
  // (`zIndex: 1000` against the badge's own `4900`), so it has to sit below
  // it rather than on top of it (#790).
  const { hidden: chromeHidden } = useChrome();
  const [seen, setSeen] = useState<SeenIdentifySeq>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [showConnectBadge, setShowConnectBadge] = useState(false);

  // Sync during render, the same shape `Observation.tsx` used for the results
  // overlay: the subscription's payload is the input, and `observeIdentify`
  // decides which of the two treatments (if either) it deserves.
  const current = assignment?.identifySeq ?? null;
  if (current !== null) {
    const observation = observeIdentify(seen, current);
    if (observation.seen !== seen) {
      setSeen(observation.seen);
      if (observation.showConnectBadge) setShowConnectBadge(true);
      if (observation.showFlash) setShowFlash(true);
    }
  }

  useEffect(() => {
    if (!showFlash) return;
    // A few seconds is enough to look up and read a name across a room; any
    // longer and it stops being a flash and starts being a mode.
    const timer = setTimeout(() => setShowFlash(false), 4000);
    return () => clearTimeout(timer);
  }, [showFlash, seen]);

  useEffect(() => {
    if (!showConnectBadge) return;
    // Must fade — a permanent badge is chrome on a projector, which is the
    // whole reason `ChromeContext` exists (#175).
    const timer = setTimeout(() => setShowConnectBadge(false), 4000);
    return () => clearTimeout(timer);
  }, [showConnectBadge]);

  const name = assignment?.name;
  if (!name) return null;

  return (
    <>
      {showConnectBadge && (inline ? (
        <div
          className="identify-connect-badge identify-connect-badge--inline"
          data-testid="identify-connect-badge"
          style={{
            // No `position` at all — an ordinary flex item beside the timer
            // status pill the caller places it next to, so it can never
            // paint over a button the way the fixed corner did (#954).
            background: 'var(--display-badge-bg-color)',
            color: 'var(--display-text-color)',
            padding: '0.4rem 0.8rem',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 'bold',
          }}
        >
          {name}
        </div>
      ) : (
        <div
          className="identify-connect-badge"
          data-testid="identify-connect-badge"
          style={{
            position: 'fixed',
            // Below `Navigation`'s bar (roughly 56px tall) when it is on
            // screen, at the corner when there is no chrome to clash with.
            top: chromeHidden ? '16px' : '76px',
            right: '16px',
            zIndex: 4900,
            background: 'var(--display-badge-bg-color)',
            color: 'var(--display-text-color)',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            pointerEvents: 'none',
          }}
        >
          {name}
        </div>
      ))}
      {showFlash && (
        <div
          className="identify-flash"
          data-testid="identify-flash"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--display-flash-bg-color)',
            color: 'var(--display-text-color)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '9vmin', fontWeight: 'bold', textAlign: 'center', padding: '0 5vmin' }}>
            {name}
          </div>
        </div>
      )}
    </>
  );
}
