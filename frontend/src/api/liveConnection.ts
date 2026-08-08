/**
 * Keeping the subscription socket alive at a venue.
 *
 * Every live screen in the app — the audience display, the operator's heat
 * view, the standings on a second monitor — is a `graphql-ws` subscription over
 * one WebSocket. The deployment is a Raspberry Pi at the front of a room and
 * two or three screens on venue wifi, which is the environment those defaults
 * are least suited to:
 *
 * - **`retryAttempts` defaults to 5.** After five abnormal closures the client
 *   errors out and never reconnects. There is no cost to retrying forever on a
 *   LAN appliance, and a display that has given up is a display showing a heat
 *   that finished twenty minutes ago.
 * - **`keepAlive` defaults to 0**, so nothing is ever sent on an idle socket.
 *   When wifi drops a client the TCP connection is left half-open: no close
 *   event fires, so no retry is triggered, and the screen goes on showing its
 *   last payload indefinitely — believing it is connected. This is the failure
 *   that produces no error anywhere and is therefore the one worth engineering
 *   against.
 *
 * `graphql-ws` sends the pings once `keepAlive` is set but deliberately does
 * nothing when a pong never comes back — the library's own documentation says
 * so and leaves the policy to the caller. `pingWatchdog` is that policy: if a
 * pong is late, close the socket, which turns a silent half-open connection
 * into the close event the retry logic already knows how to handle.
 *
 * Kept separate from `graphqlClient.ts` so it can be tested without opening a
 * socket — the behaviour worth pinning is *when we give up on a pong*, and that
 * needs fake timers, not a network.
 */

/** How often to ping an idle socket. */
export const KEEP_ALIVE_MS = 10_000;

/** How long to wait for the pong before declaring the socket dead. */
export const PONG_TIMEOUT_MS = 5_000;

/**
 * Close code for a socket that stopped answering pings.
 *
 * 4408 is `graphql-ws`'s own "Request Timeout". It matters that this is a
 * close *event* rather than an error: the client's retry path is driven by
 * close events, so this is what converts a hung connection into a reconnect.
 */
export const PONG_TIMEOUT_CLOSE_CODE = 4408;

interface SocketLike {
  readyState: number;
  close(code: number, reason: string): void;
}

/** `WebSocket.OPEN`, without needing the global in a test environment. */
const OPEN = 1;

export interface PingWatchdog {
  /** A socket has connected; watch this one from now on. */
  connected(socket: SocketLike): void;
  /** A ping went out (`received === false`) or came in (`received === true`). */
  ping(received: boolean): void;
  /** A pong went out or came in. */
  pong(received: boolean): void;
}

/**
 * Close the socket when a ping we sent goes unanswered.
 *
 * Only *our* pings start the clock. A ping arriving from the server is the
 * server checking on us, and `graphql-ws` answers those itself; treating one as
 * evidence about our own connection would start a timer that our own pong then
 * cancels, which measures nothing.
 */
export function pingWatchdog(
  timeoutMs: number = PONG_TIMEOUT_MS,
  onTimeout?: () => void,
): PingWatchdog {
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    connected(next) {
      // A fresh socket invalidates any pong we were still waiting for on the
      // old one — otherwise the timer fires and closes the replacement.
      cancel();
      socket = next;
    },
    ping(received) {
      if (received) return;
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        onTimeout?.();
        if (socket && socket.readyState === OPEN) {
          socket.close(PONG_TIMEOUT_CLOSE_CODE, 'Pong not received');
        }
      }, timeoutMs);
    },
    pong(received) {
      if (received) cancel();
    },
  };
}

/**
 * The `graphql-ws` options every live screen connects with.
 *
 * Built here rather than inline at the call site so the policy is one object a
 * test can read. What it encodes is not obvious from the values:
 *
 * - `retryAttempts: Infinity` — the default of 5 spans roughly thirty seconds
 *   of randomised backoff and then gives up *permanently*. An outage longer
 *   than half a minute is ordinary at a venue: an access point rebooting, or
 *   the operator restarting the backend to change a setting. On a LAN
 *   appliance there is nothing to protect by ever stopping.
 * - `shouldRetry` — the server being unreachable is the ordinary case, not a
 *   fatal one. A display and the Pi it talks to come up in whichever order the
 *   power strip decides.
 * - `keepAlive` with the watchdog — see the file header. Without it a
 *   half-open socket is never noticed, and no retry policy helps because no
 *   close event ever fires.
 */
export function liveConnectionOptions(url: string) {
  const watchdog = pingWatchdog();
  return {
    url,
    retryAttempts: Infinity,
    shouldRetry: () => true,
    keepAlive: KEEP_ALIVE_MS,
    on: {
      connected: (socket: unknown) => watchdog.connected(socket as SocketLike),
      ping: (received: boolean) => watchdog.ping(received),
      pong: (received: boolean) => watchdog.pong(received),
    },
  };
}
