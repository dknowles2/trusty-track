/**
 * The one sentence every locked-race control shows, wherever it shows one
 * (#585) — the roster toolbar, Race Control's schedule and result entry,
 * the awards editor, the run-off control. One string rather than a dozen
 * copies free to drift apart from each other, and matching
 * `backend.api.race_lock.LOCK_MESSAGE` word for word so the same explanation
 * reaches an operator whether the frontend caught the lock first or the
 * mutation was refused server-side.
 */
export const RACE_LOCKED_MESSAGE = "This race is locked. Unlock it from Edit race to make changes.";
