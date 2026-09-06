/**
 * Turning the browser's own address into one a phone in the room can open —
 * first written for the voting page's share step
 * ([#414](https://github.com/dknowles2/trusty-track/issues/414)), and now
 * also what the full-screen QR code display view encodes
 * ([#614](https://github.com/dknowles2/trusty-track/issues/614)). Lives
 * under `features/core/` rather than `features/awards/`, its original home,
 * for `displayName.ts`'s reason: this is read from two features with no
 * single natural owner between them, and a second copy free to drift was
 * worse than one shared file with two importers.
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
 * `mdnsHostname` ([#723](https://github.com/dknowles2/trusty-track/issues/723))
 * is preferred over a bare `networkAddresses` entry whenever the backend has
 * one: it survives the DHCP lease change that would otherwise strand a
 * display configured on Friday evening, where an IP does not. This does not
 * change what `reachable` promises — see below — it only changes *which*
 * substituted address is shown, since a `.local` name is a better answer to
 * the same question an IP was already answering.
 *
 * `reachable` means "the backend found something to substitute", never "a
 * phone confirmed it can open this" — that was already true of an IP guess
 * (DHCP could still be lying, a firewall could still be in the way) and
 * stays true of a registered hostname: mDNS registration confirms this
 * *server* answered on its own network segment, not that every phone in the
 * room can resolve `.local` names (some Android builds below 12 cannot, and
 * some guest networks block multicast the same way they isolate clients).
 * Both kinds of substitution are equally unconfirmed for the one device
 * that matters, so both get the same flag — a caller wanting more than that
 * already tells the reader to "try typing it into a phone's browser to
 * check before relying on it".
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
 * to show and to encode. `mdnsHostname` (`networkAddresses` query's sibling
 * field) wins over either when present — see the module docstring.
 */
export function shareUrl(
  origin: string,
  path: string,
  networkAddresses: readonly string[],
  mdnsHostname?: string | null,
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

  const port = parsed.port ? `:${parsed.port}` : '';

  if (mdnsHostname) {
    return { url: `${parsed.protocol}//${mdnsHostname}${port}${path}`, reachable: true };
  }

  const address = networkAddresses[0];
  if (!address) {
    return { url: `${origin}${path}`, reachable: false };
  }

  return { url: `${parsed.protocol}//${address}${port}${path}`, reachable: true };
}

/**
 * Where a QR code image comes from, for a given (already-substituted) share
 * URL — the ballot's own address, or (#614) the audience display's.
 *
 * The URL travels as a query parameter rather than being recomputed on the
 * backend from `raceId` alone: this page already worked out the one address
 * a phone can actually reach, and asking the server to redo that would be
 * two copies of the same rule free to disagree with each other. The route
 * itself is still named `vote-qr` — it shipped with the ballot first — but
 * `backend/api/main.py::voting_qr` now accepts either page's address; see
 * that function's docstring for why it was widened rather than duplicated.
 */
export function qrCodeSrc(raceId: number, url: string): string {
  return `/api/printables/vote-qr/${raceId}.png?url=${encodeURIComponent(url)}`;
}
