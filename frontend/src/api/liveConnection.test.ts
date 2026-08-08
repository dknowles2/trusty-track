import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PONG_TIMEOUT_CLOSE_CODE,
  PONG_TIMEOUT_MS,
  liveConnectionOptions,
  pingWatchdog,
} from './liveConnection';

/**
 * A socket that records how it was closed, and can pretend to be shut already.
 */
function fakeSocket(readyState = 1) {
  return {
    readyState,
    close: vi.fn<(code: number, reason: string) => void>(),
  };
}

describe('the ping watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes a socket that never answers our ping', () => {
    // The failure this exists for: venue wifi drops the client, the TCP
    // connection is left half-open, and no close event ever fires. Without
    // this the screen shows its last payload for the rest of the event.
    const socket = fakeSocket();
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).toHaveBeenCalledWith(
      PONG_TIMEOUT_CLOSE_CODE,
      'Pong not received',
    );
  });

  it('leaves a socket alone when the pong arrives', () => {
    const socket = fakeSocket();
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 1);
    watchdog.pong(true);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('keeps watching after a pong, so the next silence is still caught', () => {
    const socket = fakeSocket();
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(false);
    watchdog.pong(true);
    watchdog.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('ignores a ping the server sent us', () => {
    // `graphql-ws` answers those itself. Starting a timer on one would measure
    // our own reply rather than the server's liveness.
    const socket = fakeSocket();
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(true);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS * 2);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('ignores a pong we sent', () => {
    const socket = fakeSocket();
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(false);
    watchdog.pong(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('does not close a socket that has already gone', () => {
    const socket = fakeSocket(3 /* CLOSED */);
    const watchdog = pingWatchdog();
    watchdog.connected(socket);

    watchdog.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('does not close a reconnected socket over the old one’s missed pong', () => {
    // Reconnecting is exactly when a pong goes unanswered, so without this the
    // watchdog closes the replacement moments after it comes up — and does so
    // again on the next attempt, which is a reconnect loop rather than a
    // recovery.
    const dead = fakeSocket();
    const fresh = fakeSocket();
    const watchdog = pingWatchdog();

    watchdog.connected(dead);
    watchdog.ping(false);
    watchdog.connected(fresh);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(dead.close).not.toHaveBeenCalled();
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it('reports the timeout before closing, for anything watching', () => {
    const socket = fakeSocket();
    const onTimeout = vi.fn();
    const watchdog = pingWatchdog(PONG_TIMEOUT_MS, onTimeout);
    watchdog.connected(socket);

    watchdog.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(onTimeout).toHaveBeenCalledOnce();
  });
});

describe('the options every live screen connects with', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never stops trying to reconnect', () => {
    // `graphql-ws` defaults to five attempts, which is about thirty seconds
    // of randomised backoff and then a permanent stop. An access point
    // rebooting or the operator restarting the backend outlasts that, and a
    // display that has stopped retrying shows a finished heat all evening.
    expect(liveConnectionOptions('ws://pi.local/graphql').retryAttempts).toBe(
      Infinity,
    );
  });

  it('treats an unreachable server as retryable rather than fatal', () => {
    // The Pi and the screens come up in whatever order the power strip
    // decides, so failing to connect is a normal first state.
    expect(liveConnectionOptions('ws://pi.local/graphql').shouldRetry()).toBe(
      true,
    );
  });

  it('pings an idle socket, so a half-open connection is noticed', () => {
    // The failure mode with no error attached: wifi drops the client, no
    // close event fires, and no retry policy of any strictness helps.
    expect(
      liveConnectionOptions('ws://pi.local/graphql').keepAlive,
    ).toBeGreaterThan(0);
  });

  it('closes a socket whose pong never arrives', () => {
    // The options object has to be wired to a watchdog, not merely carry a
    // `keepAlive` — `graphql-ws` sends the pings and, by its own
    // documentation, does nothing when no pong comes back.
    const options = liveConnectionOptions('ws://pi.local/graphql');
    const socket = fakeSocket();

    options.on.connected(socket);
    options.on.ping(false);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);

    expect(socket.close).toHaveBeenCalledWith(
      PONG_TIMEOUT_CLOSE_CODE,
      'Pong not received',
    );
  });
});
