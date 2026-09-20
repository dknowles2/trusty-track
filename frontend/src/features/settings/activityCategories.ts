/**
 * The six subjects an activity-log entry can be about (#1253).
 *
 * The *vocabulary* — which action belongs to which category — lives once, on
 * the server (`backend/domain/audit.py`'s `ACTIONS_BY_CATEGORY`), and reaches
 * this page as the `category` the server already resolved on each entry
 * (`AuditLogEntry.category`). What is here is UI text only: the chip's label
 * and the one-line hint under it, keyed on the same `AuditCategory` enum
 * codegen already produced from that server type — so there is nothing here
 * to fall out of step with the action lists themselves.
 *
 * Pure. No React, no urql.
 */

import type { AuditCategory } from '../../gql/schema';

/** Every category, in the order the chip row renders them — the same order
 * the issue's own table lists them in. */
export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
    'RESULTS',
    'SCHEDULE',
    'ROSTER',
    'AWARDS',
    'DISPLAYS',
    'SETUP',
];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
    RESULTS: 'Results',
    SCHEDULE: 'Schedule',
    ROSTER: 'Roster & check-in',
    AWARDS: 'Awards & voting',
    DISPLAYS: 'Displays & room',
    SETUP: 'Setup & system',
};

export const AUDIT_CATEGORY_HINTS: Record<AuditCategory, string> = {
    RESULTS: 'Heat results: timer vs typed, overrides, re-runs',
    SCHEDULE: 'Rounds and heats: created, regenerated, deleted, reordered',
    ROSTER: 'Racers and groups: added, checked in, numbered, imported',
    AWARDS: 'Trophies and the judged-award vote',
    DISPLAYS: 'What the screens show, breaks, cameras, scenes',
    SETUP: 'Races, tracks, settings, backups, test data',
};

/** `activity-category-results`, `activity-category-roster`, … — the chip's
 * own `data-testid`. */
export function categoryTestId(category: AuditCategory): string {
    return `activity-category-${category.toLowerCase()}`;
}

/**
 * Whether an entry matches the current chip/noteworthy filter.
 *
 * `selected` empty or holding every category means no category filter at
 * all — the chip row never actually lets every chip go unselected (the last
 * one refuses to turn off), but "no filter" and "everything selected" read
 * as the same thing here regardless, matching `crud.get_audit_entries`'s own
 * "all six is the same as none" rule on the server. An entry with no
 * `category` (an action the server has not caught up with yet — should not
 * happen once `test_audit_categories.py` is green, but the field is
 * nullable) only matches when no category filter narrows the view, the same
 * as how the server's own `action IN (...)` clause would exclude it.
 */
export function matchesActivityFilter(
    entry: { category?: AuditCategory | null; noteworthy: boolean },
    selected: ReadonlySet<AuditCategory>,
    noteworthyOnly: boolean,
): boolean {
    if (noteworthyOnly && !entry.noteworthy) return false;
    if (selected.size === 0 || selected.size >= AUDIT_CATEGORIES.length) return true;
    return entry.category != null && selected.has(entry.category);
}
