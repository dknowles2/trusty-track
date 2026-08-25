import { describe, it, expect } from 'vitest';
import {
  IDLE_AFTER_MS,
  SESSION_LIMIT_MS,
  isPaused,
  reduce,
  startSession,
  type DemoSession,
  type DemoSessionEvent,
} from './demoSession';

const T0 = 1_000_000;

/** Feed a sequence of events, returning the final session and every command. */
function run(events: DemoSessionEvent[], from: DemoSession = startSession(T0)) {
  const commands: string[] = [];
  let session = from;
  for (const event of events) {
    const result = reduce(session, event);
    session = result.session;
    commands.push(...result.commands);
  }
  return { session, commands };
}

describe('a demo session', () => {
  it('starts active', () => {
    expect(startSession(T0).phase).toBe('ACTIVE');
    expect(isPaused(startSession(T0))).toBe(false);
  });

  it('stays active while the visitor keeps interacting', () => {
    const events: DemoSessionEvent[] = [];
    // Well past the idle timeout in total, but never idle for long enough.
    for (let at = T0; at < T0 + IDLE_AFTER_MS * 3; at += IDLE_AFTER_MS / 2) {
      events.push({ type: 'INTERACTION', at });
      events.push({ type: 'TICK', at: at + 1 });
    }

    const { session, commands } = run(events);

    expect(session.phase).toBe('ACTIVE');
    expect(commands).toEqual([]);
  });

  it('goes idle once nobody has touched it', () => {
    const { session, commands } = run([{ type: 'TICK', at: T0 + IDLE_AFTER_MS }]);

    expect(session.phase).toBe('IDLE');
    expect(commands).toEqual(['CLOSE_CONNECTION']);
  });

  it('does not go idle a moment early', () => {
    const { session } = run([{ type: 'TICK', at: T0 + IDLE_AFTER_MS - 1 }]);

    expect(session.phase).toBe('ACTIVE');
  });

  it('ends a session that has run its full length', () => {
    const { session, commands } = run([
      { type: 'INTERACTION', at: T0 + SESSION_LIMIT_MS - 1 },
      { type: 'TICK', at: T0 + SESSION_LIMIT_MS },
    ]);

    expect(session.phase).toBe('ENDED');
    expect(commands).toEqual(['CLOSE_CONNECTION']);
  });

  it('ends rather than idles when both are due', () => {
    // Checked in this order on purpose: a visitor still clicking at twenty
    // minutes is ENDED, where checking idleness first would let continuous use
    // hold a session open forever — the case the cap exists for.
    const { session } = run([{ type: 'TICK', at: T0 + SESSION_LIMIT_MS + IDLE_AFTER_MS }]);

    expect(session.phase).toBe('ENDED');
  });

  it('closes the connection exactly once', () => {
    const { commands } = run([
      { type: 'TICK', at: T0 + IDLE_AFTER_MS },
      { type: 'TICK', at: T0 + IDLE_AFTER_MS + 1 },
      { type: 'TICK', at: T0 + IDLE_AFTER_MS + 60_000 },
    ]);

    expect(commands).toEqual(['CLOSE_CONNECTION']);
  });

  it('is not revived by a mouse move', () => {
    // The socket is already gone. Going back to ACTIVE would leave a
    // subscription-driven page silently receiving nothing, which is the exact
    // failure `pingWatchdog` exists to prevent.
    const { session, commands } = run([
      { type: 'TICK', at: T0 + IDLE_AFTER_MS },
      { type: 'INTERACTION', at: T0 + IDLE_AFTER_MS + 1_000 },
      { type: 'TICK', at: T0 + IDLE_AFTER_MS + 2_000 },
    ]);

    expect(session.phase).toBe('IDLE');
    expect(commands).toEqual(['CLOSE_CONNECTION']);
  });

  it('reports both stopped phases as paused', () => {
    expect(isPaused({ phase: 'IDLE', startedAt: T0, lastInteractionAt: T0 })).toBe(true);
    expect(isPaused({ phase: 'ENDED', startedAt: T0, lastInteractionAt: T0 })).toBe(true);
  });

  it('gives a visitor the whole idle window back after each interaction', () => {
    const { session } = run([
      { type: 'INTERACTION', at: T0 + IDLE_AFTER_MS - 1 },
      { type: 'TICK', at: T0 + IDLE_AFTER_MS * 2 - 2 },
    ]);

    expect(session.phase).toBe('ACTIVE');
  });
});
