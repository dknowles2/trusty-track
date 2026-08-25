/**
 * When the public demo stops holding its socket open.
 *
 * The demo scales to zero when nothing is connected, so the whole cost risk is
 * one visitor who opens it, wanders off, and leaves the tab open: the
 * subscription socket stays in flight and the instance never sleeps. Cost does
 * not scale with viewers — the host bills instance-time, not request-time — so
 * this is not about how many people are watching. It is about one that is not.
 *
 * What this has to fight
 * ----------------------
 * `liveConnection.ts` is built to *never* stay disconnected, and every part of
 * that is deliberate: retry forever, ping an idle socket, and close a half-open
 * one so the retry path notices. All three are right for a gym on race day and
 * all three are exactly wrong for scaling to zero. So the demo latches instead
 * of disabling any of it — the retry policy is untouched, and what changes is
 * that the connection is disposed and not reopened.
 *
 * Which is why the phases are one-way. Once the socket is gone the screen is no
 * longer live, and reviving on a mouse move would leave a subscription-driven
 * page silently receiving nothing — the exact failure `pingWatchdog` exists to
 * prevent, reintroduced by the thing meant to save money. Resuming is a
 * reload, following the PIN's precedent (#15): rebuilding the urql client and
 * its normalized cache mid-session is a great deal of machinery for something
 * that happens once.
 *
 * Pure, with the doing in the component — the same split as `raceFlow.ts` and
 * `chime.ts`. The test for whether something belongs here: it does not survive
 * a refresh.
 */

/** No interaction for this long and the socket goes. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** However busy the visitor is, a session lasts no longer than this. */
export const SESSION_LIMIT_MS = 20 * 60_000;

export type DemoPhase =
  /** Connected, and somebody is using it. */
  | 'ACTIVE'
  /** Nobody has touched it. The socket is closed; a reload brings it back. */
  | 'IDLE'
  /** The session ran its full length. Also a reload, but a different sentence. */
  | 'ENDED';

export interface DemoSession {
  phase: DemoPhase;
  /** When this page load began. */
  startedAt: number;
  /** The last time the visitor did something. */
  lastInteractionAt: number;
}

export type DemoSessionEvent =
  | { type: 'INTERACTION'; at: number }
  | { type: 'TICK'; at: number };

/**
 * Close the subscription socket and do not reopen it.
 *
 * A command rather than a call, so the rules above can be asserted without a
 * WebSocket — `raceFlow.ts`'s shape, for `raceFlow.ts`'s reason.
 */
export type DemoSessionCommand = 'CLOSE_CONNECTION';

export interface DemoSessionResult {
  session: DemoSession;
  commands: DemoSessionCommand[];
}

export function startSession(at: number): DemoSession {
  return { phase: 'ACTIVE', startedAt: at, lastInteractionAt: at };
}

/** Whether the visitor is looking at an overlay rather than the app. */
export function isPaused(session: DemoSession): boolean {
  return session.phase !== 'ACTIVE';
}

export function reduce(session: DemoSession, event: DemoSessionEvent): DemoSessionResult {
  // Terminal, and deliberately unreachable by any event. The socket is already
  // gone; the only way back is a page load, which builds a new session.
  if (session.phase !== 'ACTIVE') {
    return { session, commands: [] };
  }

  const touched =
    event.type === 'INTERACTION'
      ? { ...session, lastInteractionAt: event.at }
      : session;

  // The cap is checked first, so a visitor still clicking at twenty minutes is
  // ENDED rather than ACTIVE. Checking idleness first would let continuous use
  // hold a session open indefinitely, which is the case the cap exists for.
  if (event.at - touched.startedAt >= SESSION_LIMIT_MS) {
    return { session: { ...touched, phase: 'ENDED' }, commands: ['CLOSE_CONNECTION'] };
  }

  if (event.at - touched.lastInteractionAt >= IDLE_AFTER_MS) {
    return { session: { ...touched, phase: 'IDLE' }, commands: ['CLOSE_CONNECTION'] };
  }

  return { session: touched, commands: [] };
}
