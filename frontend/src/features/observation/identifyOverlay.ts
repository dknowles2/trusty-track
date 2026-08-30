/**
 * Deciding when a display should say its own name (#495).
 *
 * A memorable default name (`backend/domain/display_names.py`) is only half
 * of it — the operator still has to learn which row on the Displays panel is
 * the projector at the back. Two treatments share one `identifySeq`, and both
 * follow the same `seen === null` shape `resultsOverlay.ts` uses and
 * `AwardCeremony` already applies to `slide_seq`:
 *
 * - **On this display's very first payload** — a fresh connect or a reload —
 *   a small corner badge names the screen briefly. Plugging a screen in and
 *   opening it is the cheapest possible moment for somebody to learn its
 *   name, and it fades: a permanent badge is chrome on a projector, which is
 *   what #174's `ChromeContext` work was about getting rid of. A reconnect
 *   under a page that never unmounted keeps whatever `seen` it already held,
 *   so it does not re-badge — a screen re-badging itself on every wifi wobble
 *   would be its own kind of noise.
 * - **On an Identify command from the operator's list** — `identifySeq`
 *   *rising* above the value this display already obeyed — the name flashes
 *   across the whole screen. A counter that has gone down is not a command:
 *   presence lives in memory (`services/displays.py`), so a restarted server
 *   or a forgotten-then-reconnected display rebuilds the registry at zero,
 *   and that value is history exactly like the one a fresh connection
 *   arrives holding — obeying it would flash every screen in the room the
 *   moment the Pi comes back (#520).
 *
 * Both are edges, not states — the caller compares the previous call's `seen`
 * against a fresh one, the same shape `observeHeatResult` uses, so "did this
 * just happen" lives in one pure, tested place rather than a page's effects.
 */

/** What we had seen last time, or `null` before the first payload. */
export type SeenIdentifySeq = number | null;

export interface IdentifyObservation {
    /** To carry into the next call. */
    readonly seen: SeenIdentifySeq;
    /** True exactly once per connection: this display's first payload. */
    readonly showConnectBadge: boolean;
    /** True when `current` is a new Identify command, not a reconnection. */
    readonly showFlash: boolean;
}

/**
 * @param seen  the `seen` from the previous call, or `null` on the first.
 * @param current  the `identifySeq` on the most recent payload, or `null`
 *   before any payload has arrived at all.
 */
export function observeIdentify(seen: SeenIdentifySeq, current: number | null): IdentifyObservation {
    if (current === null) return { seen, showConnectBadge: false, showFlash: false };

    if (seen === null) {
        // A fresh connection (or reconnection): whatever this display arrived
        // holding is history, not an instruction to flash.
        return { seen: current, showConnectBadge: true, showFlash: false };
    }

    // A command is a counter that has gone *up*. One that has gone down —
    // or simply not moved — is history: the registry lost this display and
    // rebuilt it at zero, whether from a server restart (#520) or a
    // forget-and-reconnect, and obeying it would flash the name on every
    // screen in the room for a command nobody sent.
    return { seen: current, showConnectBadge: false, showFlash: current > seen };
}
