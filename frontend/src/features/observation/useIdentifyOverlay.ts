/**
 * The stateful half of "a display says its own name" (#495), split out of
 * `IdentifyPresence` so it can be called exactly once per screen rather than
 * once per place that screen might render the badge.
 *
 * Before #1071/#1072, `IdentifyPresence` held `seen`/`showConnectBadge`/
 * `showFlash` itself, and both `Observation.tsx` and `AwardCeremony.tsx`
 * render from several different `if`-branch returns — one per view, plus the
 * break overlay, plus (on `AwardCeremony`) the ceremony slide itself. Each
 * branch is a structurally distinct place in the JSX tree, so switching
 * between them (including into and out of a break) unmounted whichever
 * `IdentifyPresence` instance was rendered and mounted a fresh one holding no
 * history: a display re-badged itself as freshly connected, and an Identify
 * sent mid-break was swallowed as "history" the moment the break ended.
 *
 * Holding the state here, in a hook called once at the top of the page
 * component — which does not itself unmount when its *return value* changes
 * shape — survives every one of those transitions; only which JSX renders
 * the (now purely presentational) `IdentifyPresence` component varies.
 */

import { useEffect, useState } from 'react';
import { observeIdentify, type SeenIdentifySeq } from './identifyOverlay';

export interface IdentifyAssignment {
  readonly name?: string | null;
  readonly identifySeq?: number | null;
}

export interface IdentifyOverlayState {
  readonly name?: string | null;
  readonly showConnectBadge: boolean;
  readonly showFlash: boolean;
}

export function useIdentifyOverlay(assignment: IdentifyAssignment | null): IdentifyOverlayState {
  const [seen, setSeen] = useState<SeenIdentifySeq>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [showConnectBadge, setShowConnectBadge] = useState(false);

  // Sync during render, the same shape `Observation.tsx` uses for the results
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

  return { name: assignment?.name, showConnectBadge, showFlash };
}
