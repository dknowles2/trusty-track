/**
 * The operator PIN this device holds (#15).
 *
 * Roles are enforced server-side; this is only the credential's home on the
 * client. It is stored per *device*, which is the whole point — the operator's
 * laptop holds the operator PIN, the desk's tablet holds the check-in one, and
 * a display on the wall holds nothing at all and stays a viewer.
 *
 * Storage is wrapped because it throws rather than returning null in some
 * browser configurations, and a missing PIN must degrade to "viewer", never to
 * a screen that fails to render.
 */

const STORAGE_KEY = 'trustytrack.pin';

export function readPin(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePin(pin: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, pin);
  } catch {
    // Nothing to do about it, and nothing to break: the client simply keeps
    // sending no PIN and stays a viewer.
  }
}

export function clearPin(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

/**
 * Header the PIN travels in, matching `auth.PIN_HEADER` on the server.
 *
 * A header rather than a cookie: the request is same-origin, so there is no
 * CORS exposure and `allow_credentials` stays off. On a LAN over plain HTTP a
 * bearer token would be no less readable than the PIN, and would add an expiry
 * and a signing secret to get wrong.
 */
export const PIN_HEADER = 'x-trustytrack-pin';

/** Headers for a request, carrying the PIN if this device holds one. */
export function pinHeaders(): Record<string, string> {
  const pin = readPin();
  return pin ? { [PIN_HEADER]: pin } : {};
}

/**
 * The subscription URL, carrying the PIN as a query parameter.
 *
 * A WebSocket handshake cannot set headers from the browser — there is no API
 * for it — so the socket takes the PIN in the URL instead. That is the reason
 * for the asymmetry with `pinHeaders`, not an oversight.
 */
export function withPin(url: string): string {
  const pin = readPin();
  if (!pin) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}pin=${encodeURIComponent(pin)}`;
}
