/**
 * Turning the browser's own address into one a phone in the room can open,
 * for the voting page's share step ([#414](https://github.com/dknowles2/trusty-track/issues/414)).
 *
 * `window.location.origin` names the machine from its own point of view. On
 * the documented setup — one machine at the venue, the operator's own
 * laptop — that is `http://localhost:8000`, which meant nothing to a phone
 * on the venue wifi: the one thing the sharing step told someone to do was
 * the one thing that address could not do.
 *
 * The browser has no way to do better on its own — it cannot see its own LAN
 * address any more than the phone can resolve `localhost` to someone else's
 * machine. The backend can, because it is the thing actually bound to the
 * network (`networkAddresses`, `backend/services/network.py`), so this
 * substitutes one of those in only when the browser's own address would not
 * reach past this machine — keeping the browser's own protocol, port and
 * path, since the frontend and the API are served from the same origin and
 * the port the phone needs is whatever the browser is already using.
 *
 * Pure — no fetch, no DOM beyond the `URL` parser — so it can be tested with
 * a table of origins rather than a browser.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export interface ShareAddress {
  /** The address to show and to encode in the QR code — never blank. */
  url: string;
  /**
   * False when nothing here could confirm a phone off this machine can
   * reach `url` — either the origin is loopback and no LAN address was
   * found, or the origin could not be parsed at all. The caller must warn
   * rather than imply the address works.
   */
  reachable: boolean;
}

/**
 * `origin` is `window.location.origin` (protocol + host, no trailing
 * slash); `path` is appended as-is, so the caller owns the leading slash.
 * `networkAddresses` are candidate LAN addresses from the backend, in the
 * order it reported them (sorted) — the first is used, since any one of
 * them is as good as any other and the page needs to settle on exactly one
 * to show and to encode.
 */
export function shareUrl(
  origin: string,
  path: string,
  networkAddresses: readonly string[],
): ShareAddress {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { url: `${origin}${path}`, reachable: false };
  }

  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return { url: `${origin}${path}`, reachable: true };
  }

  const address = networkAddresses[0];
  if (!address) {
    return { url: `${origin}${path}`, reachable: false };
  }

  const port = parsed.port ? `:${parsed.port}` : '';
  return { url: `${parsed.protocol}//${address}${port}${path}`, reachable: true };
}

/**
 * Where the ballot QR code comes from, for a given (already-substituted)
 * share URL.
 *
 * The URL travels as a query parameter rather than being recomputed on the
 * backend from `raceId` alone: this page already worked out the one address
 * a phone can actually reach, and asking the server to redo that would be
 * two copies of the same rule free to disagree with each other.
 */
export function voteQrSrc(raceId: number, url: string): string {
  return `/api/printables/vote-qr/${raceId}.png?url=${encodeURIComponent(url)}`;
}
