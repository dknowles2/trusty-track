import { useEffect, useReducer } from 'react';
import { closeLiveConnection } from '../../../api/graphqlClient';
import {
  isPaused,
  reduce,
  startSession,
  type DemoSessionEvent,
  type DemoSessionResult,
} from '../../../api/demoSession';

/**
 * How often to ask whether the session has run out.
 *
 * A poll rather than a timer armed for the exact deadline: a laptop that sleeps
 * with the tab open does not fire a pending `setTimeout` on the schedule it was
 * given, and waking to find the demo still connected is the case this exists to
 * prevent. Comparing wall-clock on each tick is immune to that.
 */
const TICK_MS = 15_000;

/** Events that mean a person is there. */
const INTERACTIONS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function step(state: DemoSessionResult, event: DemoSessionEvent): DemoSessionResult {
  return reduce(state.session, event);
}

/**
 * Stops the demo holding its socket open when nobody is using it.
 *
 * The rules are in `api/demoSession.ts` and this is the wiring — `raceFlow.ts`'s
 * split, for its reason. The reducer stays pure and hands back *commands*; the
 * effect below is what actually closes the socket, which is the shape React
 * wants anyway, since that is synchronising with something outside the tree.
 *
 * Renders nothing when the flag is off, which is every install that is not the
 * public demo.
 */
export function DemoSessionGate({ enabled }: { enabled: boolean }) {
  const [state, dispatch] = useReducer(step, undefined, () => ({
    session: startSession(Date.now()),
    commands: [],
  }));

  useEffect(() => {
    if (!enabled) return;

    const onInteraction = () => dispatch({ type: 'INTERACTION', at: Date.now() });
    for (const name of INTERACTIONS) {
      // Passive: none of these are cancelled, and a non-passive `wheel`
      // listener makes the page scroll janky for the whole session.
      window.addEventListener(name, onInteraction, { passive: true });
    }

    const timer = setInterval(() => dispatch({ type: 'TICK', at: Date.now() }), TICK_MS);

    return () => {
      for (const name of INTERACTIONS) window.removeEventListener(name, onInteraction);
      clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    // `dispose()` cannot be undone, so this must only run for a phase the
    // reducer will not leave. It is one-way by construction — see the module.
    if (enabled && state.commands.includes('CLOSE_CONNECTION')) closeLiveConnection();
  }, [enabled, state]);

  if (!enabled || !isPaused(state.session)) return null;

  const ended = state.session.phase === 'ENDED';

  return (
    <div
      className="demo-paused"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-paused-title"
    >
      <div className="demo-paused-card">
        <h2 id="demo-paused-title">{ended ? 'Demo session ended' : 'Demo paused'}</h2>
        <p>
          {ended
            ? 'This demo runs for twenty minutes at a time. Start again for a fresh race.'
            : 'The demo disconnected because nothing was happening. Nothing has been lost.'}
        </p>
        <button type="button" onClick={() => window.location.reload()} autoFocus>
          Start again
        </button>
      </div>
    </div>
  );
}
