/**
 * Where a replay clip starts and ends, and where `t0` falls inside it
 * (#177 stage 1b).
 *
 * Pure arithmetic over plain numbers (epoch milliseconds and seconds) — no
 * WebCodecs, no MediaRecorder, no GraphQL. `Camera.tsx` is the only real
 * caller; everything here is exercised directly in `clipBounds.test.ts`
 * with no browser or backend involved, the same "sweep the pure rule"
 * reasoning `test_domain_scheduling.py` uses.
 */

export interface Transition {
  readonly toState: string;
  /** ISO 8601 UTC, the server's own clock — `TimerStatus.transitions[].at`,
   * load-bearing outside the debug panel for the first time (see
   * `.claude/rules/timers.md`). */
  readonly at: string;
}

/** Defaults named in the issue: 1.5s of lead-in, 1.0s of follow-through. */
export const DEFAULT_PRE_ROLL_MS = 1500;
export const DEFAULT_POST_ROLL_MS = 1000;

/** The fixed skipback the `TimerType.NONE` fallback uses — DerbyNet's own
 * shape, named in the issue — for a track with no gate-open event to anchor
 * a clip to at all. */
export const NONE_FALLBACK_SKIPBACK_MS = 4000;

/**
 * The most recent transition to `RUNNING` — this app's own name for the
 * issue's "→ RACING" gate-open event (`services/timer/state_machine.py`'s
 * `TimerState.RUNNING`) — as an epoch-ms instant, or `null` if the log
 * carries none (a track that has never armed, or a `NONE` track, which
 * never reaches `RUNNING` at all).
 *
 * `transitions` is read in the order the server sends it — oldest first,
 * the same order `TimerManager._transitions`'s own bounded deque yields —
 * so the *last* matching entry is the most recent gate-open, even across
 * more than one heat sitting in the log at once.
 */
export function latestRunningAt(transitions: readonly Transition[]): number | null {
  let found: number | null = null;
  for (const t of transitions) {
    if (t.toState === 'RUNNING') {
      const ms = Date.parse(t.at);
      if (!Number.isNaN(ms)) found = ms;
    }
  }
  return found;
}

/**
 * `t0`, corrected for half the measured round trip (the issue's own
 * phrase, "half the measured WebSocket RTT" — this measures the HTTP round
 * trip instead, see `graphql/queries.ts`'s own note on `CAMERA_PING_QUERY`).
 * The server's own `at` already answers "when the gate opened, by the
 * server's clock"; half the measured RTT is added back because, by the
 * time this browser could possibly have observed that transition arriving,
 * it was already `rttMs / 2` old.
 *
 * **This is latency compensation, not clock-skew correction, and the two
 * are different problems.** If the browser's and server's clocks are
 * already close (NTP-synced, the ordinary case on a LAN), this is exactly
 * right. If they have drifted apart, this does nothing to detect or correct
 * that — doing so would need a `(client_send, server_at, client_recv)`
 * triple to derive an offset from, and `CAMERA_PING_QUERY` only returns
 * `{ version }`, no server-side timestamp. The issue's own prescribed
 * method is this heuristic, not a clock-sync protocol, and the magnitude a
 * genuine skew could introduce is bounded by ordinary LAN/Wi-Fi RTT — tens
 * of milliseconds, smaller than the pre/post-roll margins already budgeted
 * below.
 */
export function correctedT0Ms(serverAtMs: number, rttMs: number): number {
  return serverAtMs + rttMs / 2;
}

/**
 * A plain median — no library, and this is the one statistic the sync
 * method needs. Robust to one slow sample the way a mean is not, which
 * matters here: a single stalled ping must not double every later clip's
 * lead-in.
 */
export function medianMs(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface ClipBounds {
  readonly startMs: number;
  readonly endMs: number;
  /** Where `t0` (or, on the `NONE` fallback, the skipback instant) falls
   * inside the clip once it starts at `startMs` — `POST /replay/`'s own
   * `t0OffsetMs`. */
  readonly t0OffsetMs: number;
}

/**
 * The clip window for a timer-synced track: `t0 - preRoll` through
 * `t0 + slowestLane + postRoll`. `laneTimesSec` is every lane's own
 * recorded, already-positive time — filtering a DNF or a skip (any
 * non-positive stored time) is the caller's job, same as `domain/lanes.py`
 * does for scoring. An empty array (every lane a DNF) still produces a
 * clip, just with no lane time added past `t0`.
 */
export function timerSyncedBounds(
  t0Ms: number,
  laneTimesSec: readonly number[],
  preRollMs = DEFAULT_PRE_ROLL_MS,
  postRollMs = DEFAULT_POST_ROLL_MS,
): ClipBounds {
  const slowestSec = laneTimesSec.length > 0 ? Math.max(...laneTimesSec) : 0;
  const startMs = t0Ms - preRollMs;
  const endMs = t0Ms + slowestSec * 1000 + postRollMs;
  return { startMs, endMs, t0OffsetMs: t0Ms - startMs };
}

/**
 * The `TimerType.NONE` fallback — no gate-open event exists at all, so the
 * clip is cut relative to when the result was recorded instead: a fixed
 * skipback before it, and a short follow-through after (DerbyNet's own
 * shape, named in the issue). `resultAtMs` is "now" — the instant the
 * result landed — since a `NONE` track's result is hand-entered and carries
 * no server-timestamped race start to anchor to the way `RUNNING` does.
 */
export function noneFallbackBounds(
  resultAtMs: number,
  skipbackMs = NONE_FALLBACK_SKIPBACK_MS,
  postRollMs = DEFAULT_POST_ROLL_MS,
): ClipBounds {
  const startMs = resultAtMs - skipbackMs;
  const endMs = resultAtMs + postRollMs;
  return { startMs, endMs, t0OffsetMs: skipbackMs };
}
