/**
 * Keeping the activity log current without a Refresh click (#1078).
 *
 * The log stays a query, not a subscription — `.claude/rules/
 * auth-and-demo.md`'s "A query, not a subscription" explains why: half the
 * entries are written from `crud`, outside any request (the timer's own
 * result path), and `db` must not import the api layer's pub/sub to publish
 * from there. Live rides the `race_state:{race_id}` channel every mutation
 * and the timer already publish on (`useRaceStateChanged`, the same hook
 * `Observation.tsx` uses for intermissions) and refetches the query on each
 * event instead of opening a second channel.
 *
 * What is pure here: the per-device on/off flag, and folding a freshly
 * fetched front page into what is already on screen without moving
 * anything the operator is currently reading — a newly seen entry waits as
 * `pending` until they ask for it.
 */

import type { LogEntry } from './activityLog';

const STORAGE_KEY = 'trustytrack.activityLive';

/** Whether this device wants Live on. Off by default, per device, like the chime. */
export function readLiveSetting(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
    try {
        return storage.getItem(STORAGE_KEY) === 'on';
    } catch {
        return false;
    }
}

export function writeLiveSetting(
    enabled: boolean,
    storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
    try {
        storage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
        // Ignore storage write failures — Live still works for this session,
        // it just will not be remembered for the next one.
    }
}

/**
 * What is new since `loaded`, out of a freshly fetched front page.
 *
 * Recomputed from scratch against `loaded` on every live refresh rather than
 * accumulated onto the previous `pending`: a freshly fetched front page
 * already carries everything written since the log began, so comparing
 * straight against what is actually on screen is both simpler and
 * self-correcting if an earlier live refresh was missed or arrived out of
 * order — accumulating deltas could not recover from either.
 *
 * `matchesFilter` (#1253) is checked too, so the "N new entries" chip counts
 * only what the current category/noteworthy filter would show. The live
 * poll's own query already narrows `fetched` to that filter server-side
 * (`ACTIVITY_LOG_LIVE_QUERY`), which is the ordinary case; this is the
 * defence for the one it does not cover — a poll already in flight when the
 * operator changes the filter is answered against the filter it was *sent*
 * under, and by the time it lands the filter on screen may have moved on.
 * Defaults to "everything matches" so a caller with no filter of its own
 * (there is none today outside `ActivityLog.tsx`) is unaffected.
 */
export function pendingSince(
    loaded: readonly LogEntry[],
    fetched: readonly LogEntry[],
    matchesFilter: (entry: LogEntry) => boolean = () => true,
): LogEntry[] {
    const known = new Set(loaded.map((entry) => entry.id));
    return fetched.filter((entry) => !known.has(entry.id) && matchesFilter(entry));
}

/**
 * Fold buffered `pending` entries onto `loaded`, for the moment the operator
 * actually asks for them (the "N new entries" chip).
 *
 * Not done automatically on arrival: an operator who has scrolled down, or
 * loaded older pages via "Load older entries", would have the page grow out
 * from under them the instant a heat result landed. Buffering means Live
 * never moves anything on screen until they ask it to.
 */
export function applyPendingEntries(
    loaded: readonly LogEntry[],
    pending: readonly LogEntry[],
): LogEntry[] {
    if (pending.length === 0) return [...loaded];
    const known = new Set(loaded.map((entry) => entry.id));
    const fresh = pending.filter((entry) => !known.has(entry.id));
    if (fresh.length === 0) return [...loaded];
    // Newest first, matching every other list on this page — `fresh` is
    // already in that order because it came straight off the query.
    return [...fresh, ...loaded];
}
