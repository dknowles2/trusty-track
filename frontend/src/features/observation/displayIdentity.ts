/**
 * Which screen this is (#174, #590).
 *
 * The display chooses its own id and keeps it, rather than being handed one by
 * the server. That is what makes a screen the *same* screen after a reload —
 * an id the server invented would be forgotten by the browser, and the
 * operator would watch a new row appear every time somebody bumped the
 * trolley and lose the name they had given it.
 *
 * Stored per device, like the PIN, and for the same reason: it is a fact about
 * this browser rather than about the event — but "this browser" used to mean
 * `localStorage`, which is shared by every tab a computer has open. Two
 * monitors on one machine, or a projector next to an operator's own preview
 * tab, reported the exact same id, so assigning a view to one moved both at
 * once. Three levers, tried in order:
 *
 * 1. `?displayId=` in the URL always wins. It is also copied into
 *    `sessionStorage`, so an in-app redirect that drops the query string —
 *    Observation to the awards ceremony, on an `AWARDS` assignment — still
 *    resolves to the same screen on its next call.
 * 2. Failing that, `sessionStorage` already holding an id for *this tab*
 *    wins. `sessionStorage` survives a reload of the same tab and nothing
 *    else, which is exactly "reloading keeps a screen's id, a new tab does
 *    not inherit it" — the acceptance criterion this module exists to meet.
 * 3. Failing that, this is the tab's first look, and the device id in
 *    `localStorage` — the one every screen on this computer used to share —
 *    is up for grabs. Whichever tab asks first claims it; a tab that finds
 *    the claim still warm mints an id of its own instead of colliding.
 *
 * The claim is a heartbeat, not a lock that can be left held: the tab that
 * claims the device id renews a timestamp in `localStorage` every few
 * seconds for as long as some page on it keeps calling
 * `startDeviceClaimHeartbeat` (wired from a `useEffect`, so it runs for the
 * life of the tab and stops when the tab navigates away for good or closes),
 * and a claim older than the stale window is treated as abandoned.
 * `BroadcastChannel` would settle a collision more precisely, but it needs an
 * async round trip before either side can answer, and `displayId()` has to
 * hand back a value the instant a page mounts — before its own subscription
 * can even ask the server who it is. A heartbeat answers synchronously off
 * storage, which is what that timing needs, at the cost of a several-second
 * window after a genuine holder closes during which a brand new tab mints a
 * fresh id rather than reclaiming the device id — survivable, since a fresh
 * id still works as its own screen; it just is not the one the machine used
 * to be known by.
 *
 * A screen minted this way (case 3, contested) never registers a heartbeat
 * of its own: nothing else on the computer is trying to claim its id, since
 * nobody else knows it exists until the operator's list shows it.
 */

const STORAGE_KEY = 'trustytrack.displayId';
const SESSION_KEY = 'trustytrack.displayId.session';
const CLAIM_KEY = 'trustytrack.displayId.claim';

/** How long a claim goes unrenewed before a new tab treats it as abandoned. */
const CLAIM_STALE_MS = 5000;

/** How often the holding tab renews its claim. Well under the stale window. */
export const CLAIM_HEARTBEAT_MS = 2000;

function randomId(): string {
    // `crypto.randomUUID` is unavailable on plain HTTP in some browsers, and a
    // venue LAN is exactly that. The fallback does not need to be
    // cryptographic — it distinguishes four screens in a gym.
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * This computer's shared device id, creating one the first time. Falls back
 * to a per-call id when storage throws, which it does in some privacy
 * configurations — a screen that registers afresh on every reload is still
 * better than one that cannot be assigned at all.
 */
function deviceId(): string {
    try {
        const existing = window.localStorage.getItem(STORAGE_KEY);
        if (existing) return existing;
        const created = randomId();
        window.localStorage.setItem(STORAGE_KEY, created);
        return created;
    } catch {
        return randomId();
    }
}

function readSession(): string | null {
    try {
        return window.sessionStorage.getItem(SESSION_KEY);
    } catch {
        return null;
    }
}

function writeSession(id: string): void {
    try {
        window.sessionStorage.setItem(SESSION_KEY, id);
    } catch {
        // Best effort — a tab that cannot remember its id just resolves
        // fresh on every call, per the same fallback `deviceId` makes.
    }
}

function readClaimAt(): number | null {
    try {
        const raw = window.localStorage.getItem(CLAIM_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        const ts = (parsed as { ts?: unknown } | null)?.ts;
        return typeof ts === 'number' ? ts : null;
    } catch {
        return null;
    }
}

function writeClaimNow(): void {
    try {
        window.localStorage.setItem(CLAIM_KEY, JSON.stringify({ ts: Date.now() }));
    } catch {
        // Best effort, same as everywhere else here.
    }
}

/**
 * This tab's display id, resolving (and, the first time, claiming or
 * minting) one if it does not already have one.
 *
 * `urlDisplayId` is the `?displayId=` query parameter, read by the caller
 * (`useSearchParams` in React Router) — this module has no view of the URL
 * on its own, the same split `displayView.ts` uses for `readUrl`.
 */
export function displayId(urlDisplayId?: string | null): string {
    if (urlDisplayId) {
        writeSession(urlDisplayId);
        return urlDisplayId;
    }

    const fromSession = readSession();
    if (fromSession) return fromSession;

    const id = deviceId();
    const claimedAt = readClaimAt();
    const claimIsWarm = claimedAt !== null && Date.now() - claimedAt < CLAIM_STALE_MS;
    if (claimIsWarm) {
        // Another tab on this computer is already renewing this id's claim.
        // This tab is a second screen, not a reload of the first.
        const fresh = randomId();
        writeSession(fresh);
        return fresh;
    }

    writeClaimNow();
    writeSession(id);
    return id;
}

/**
 * Keeps this tab's claim on the device id renewed for as long as it holds
 * one — a no-op, returning a no-op cleanup, for a tab that resolved to a
 * session-only id instead, since nothing else is contesting that id. Call
 * from a `useEffect` on any page that calls `displayId()`.
 */
export function startDeviceClaimHeartbeat(id: string): () => void {
    if (id !== deviceId()) return () => {};
    const interval = window.setInterval(writeClaimNow, CLAIM_HEARTBEAT_MS);
    return () => window.clearInterval(interval);
}

/**
 * The address of a brand-new screen on this computer, for Race Control's
 * "Open a new display window" button (#590). A fresh id is baked into the
 * query string rather than left for the new tab to work out for itself —
 * that is what lets it become a second screen immediately, with nothing to
 * contest, instead of racing this tab's own claim on the shared device id.
 */
export function newDisplayWindowUrl(raceId: number): string {
    return `/race/${raceId}/observation?displayId=${encodeURIComponent(randomId())}`;
}
