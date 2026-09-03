/**
 * The countdown maths for a race-scoped break (#592).
 *
 * The server resolves `Race.intermission` (`active`, `remainingSeconds`,
 * `paused`, `label`, `endsAt`) fresh on every read and again on every
 * `raceStateChanged` event carrying `kind: INTERMISSION` — but a wall display
 * ticking a countdown down to the second cannot wait on a server round trip
 * for every tick, and does not need to: `endsAt` is an ISO 8601 timestamp, so
 * a client with its own `setInterval` can derive the live number itself. This
 * module is that derivation, pure so it is testable with a fixed clock rather
 * than a fake timer wired through a component.
 *
 * Paused is not derivable this way — nothing is counting down — so a paused
 * intermission's `remainingSeconds` is trusted as-is rather than measured
 * against `now`. That mirrors the backend's own `domain.intermission.resolve`:
 * running is computed from a timestamp, paused is a stored number.
 */

export interface IntermissionData {
  readonly active: boolean;
  readonly remainingSeconds: number;
  readonly paused: boolean;
  readonly label?: string | null;
  readonly endsAt?: string | null;
}

/** No break — the shape `Race.intermission` reports when nothing is on. */
export const NONE: IntermissionData = {
  active: false,
  remainingSeconds: 0,
  paused: false,
  label: null,
  endsAt: null,
};

/**
 * How many seconds are left right now, measured against the caller's own
 * clock for a running countdown and read straight off the payload for a
 * paused one.
 *
 * Never negative — a countdown that has run past its `endsAt` between server
 * events reads as zero rather than a negative number a caller would have to
 * clamp itself.
 */
export function liveRemainingSeconds(intermission: IntermissionData, now: Date): number {
  if (intermission.paused || !intermission.endsAt) {
    return Math.max(0, Math.round(intermission.remainingSeconds));
  }
  const target = new Date(intermission.endsAt).getTime();
  const remaining = (target - now.getTime()) / 1000;
  return Math.max(0, Math.round(remaining));
}

/**
 * Whether the overlay should still be showing, measured against the caller's
 * own clock.
 *
 * `intermission.active` alone is not enough: it is a snapshot from whenever
 * the payload arrived, and a running countdown can cross zero seconds later
 * with no new event to say so — nothing resolves it again until the next
 * mutation. Folding in the live remaining time is what lets a display hide
 * its own overlay the instant the clock runs out rather than a few seconds
 * late, or leaving it up between the deadline and the operator's "End now".
 */
export function isLiveActive(intermission: IntermissionData, now: Date): boolean {
  return intermission.active && liveRemainingSeconds(intermission, now) > 0;
}

/** "4:32" — always `m:ss`, however many minutes are left. Never negative. */
export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The durations offered as one-click presets, on Race Control and on the
 * round-summary modal's "Take a break" row alike — one list, so the two
 * screens cannot quietly drift into offering different choices. */
export const INTERMISSION_PRESETS: ReadonlyArray<{ readonly label: string; readonly seconds: number }> = [
  { label: '5 min', seconds: 5 * 60 },
  { label: '10 min', seconds: 10 * 60 },
  { label: '15 min', seconds: 15 * 60 },
];

/** How much a single "+5 min" click adds. */
export const EXTEND_SECONDS = 5 * 60;
