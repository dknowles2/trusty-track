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

export interface IdentifyAssignment {
  readonly name?: string | null;
  readonly identifySeq?: number | null;
}

interface Props {
  /** The same `displayAssignment` payload both pages already subscribe to. */
  assignment: IdentifyAssignment | null;
}

/**
 * Renders nothing until this display has a name to show. Place it once, near
 * the root of whatever full-screen surface the page renders — both existing
 * treatments are `position: fixed`.
 */
export default function IdentifyPresence({ assignment }: Props) {
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
      {showConnectBadge && (
        <div
          className="identify-connect-badge"
          data-testid="identify-connect-badge"
          style={{
            position: 'fixed',
            top: '16px',
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
      )}
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
