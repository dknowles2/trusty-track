/**
 * Which screen this is (#174).
 *
 * The display chooses its own id and keeps it, rather than being handed one by
 * the server. That is what makes a screen the *same* screen after a reload —
 * an id the server invented would be forgotten by the browser, and the
 * operator would watch a new row appear every time somebody bumped the
 * trolley and lose the name they had given it.
 *
 * Stored per device, like the PIN, and for the same reason: it is a fact about
 * this browser rather than about the event.
 */

const STORAGE_KEY = 'trustytrack.displayId';

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
 * This device's display id, creating one the first time.
 *
 * Falls back to a per-session id when storage throws, which it does in some
 * privacy configurations. A screen that registers afresh on every reload is
 * still better than one that cannot be assigned at all — and much better than
 * an observation page that fails to render, which is the outcome this exists
 * to avoid.
 */
export function displayId(): string {
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
