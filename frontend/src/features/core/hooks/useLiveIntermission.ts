import { useEffect, useState } from 'react';
import { isLiveActive, type IntermissionData } from '../../racing/intermission';

/**
 * Whether a race-scoped break (#592) is live right now, ticked against the
 * caller's own clock rather than waited on from the server.
 *
 * `Race.intermission` is a snapshot from whenever it was last fetched, and a
 * running countdown can cross zero seconds later with no new event to say
 * so — nothing re-resolves it until the next mutation lands. This re-renders
 * once a second while a countdown is actually running (never while paused,
 * where nothing is counting down and there is nothing to re-render for), so
 * `isLiveActive` gets a fresh `now` on every tick.
 *
 * Shared by every full-screen surface a break can appear on
 * (`Observation.tsx`, `AwardCeremony.tsx` — #1072 gave the ceremony route its
 * first break handling at all) rather than copied into each: #48's lesson is
 * that a rule depending on every page remembering its own tick reaches only
 * some of them.
 */
export function useLiveIntermission(intermission: IntermissionData): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!intermission.active || intermission.paused) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [intermission.active, intermission.paused, intermission.endsAt]);

  return isLiveActive(intermission, new Date());
}
