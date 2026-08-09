/**
 * Reading the activity log (#219).
 *
 * The server decides what an entry *says* — `domain/audit.describe` renders the
 * sentence from the entry alone, so it cannot drift as the race changes
 * underneath it. What is left here is how a list of them reads on a screen:
 * grouped by day, timed to the second, and with the details unpacked from the
 * JSON the column holds.
 *
 * Pure. No React, no urql.
 */

export interface LogEntry {
    id: number;
    at: string;
    action: string;
    role: string;
    outcome: string;
    summary: string;
    noteworthy: boolean;
    raceId?: number | null;
    sourceIp?: string | null;
    details?: string | null;
}

export interface DaySection {
    /** `2026-08-09`, which is what the entries are grouped on. */
    day: string;
    /** How that day reads: "Today", "Yesterday", or a written date. */
    label: string;
    entries: LogEntry[];
}

/** A detail, unpacked for display. */
export interface DetailPair {
    label: string;
    value: string;
}

/**
 * The day an entry belongs to, in the reader's own timezone.
 *
 * Entries are stored in UTC, and grouping on the first ten characters of that
 * string would put an evening's racing under two different headings for anyone
 * west of Greenwich — which is most of the people this app is written for.
 */
export function localDay(at: string): string {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return at.slice(0, 10);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** The time of day, to the second. Seconds matter: a burst is the story. */
export function timeOfDay(at: string): string {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function dayLabel(day: string, today: string, yesterday: string): string {
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    const date = new Date(`${day}T12:00:00`);
    if (Number.isNaN(date.getTime())) return day;
    return date.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });
}

/**
 * The entries in day-sized sections, newest day first.
 *
 * `now` is a parameter rather than read from the clock here, so this stays pure
 * and a test can pin what "Today" means.
 */
export function byDay(entries: readonly LogEntry[], now: Date): DaySection[] {
    const today = localDay(now.toISOString());
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDay(yesterdayDate.toISOString());

    const sections: DaySection[] = [];
    for (const entry of entries) {
        const day = localDay(entry.at);
        const last = sections[sections.length - 1];
        if (last && last.day === day) last.entries.push(entry);
        else sections.push({ day, label: dayLabel(day, today, yesterday), entries: [entry] });
    }
    return sections;
}

/**
 * The stored details, as label/value pairs.
 *
 * Never throws. The column holds JSON this app wrote, but an audit log is
 * exactly the thing somebody reads after something went wrong, and a page that
 * failed on one malformed row would hide the nine hundred good ones around it.
 */
export function detailPairs(details: string | null | undefined): DetailPair[] {
    if (!details) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(details);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        label: humanise(key),
        value: String(value),
    }));
}

/**
 * `race.carNumberingStrategy` → `Car numbering strategy`.
 *
 * The object prefix is dropped rather than shown. A mutation takes one input
 * object, so every pair on a line carried the same prefix — "Racer · first
 * name: Alex · Racer · last name: Rivera · Racer · car number: 3" — which is
 * half the text saying something the action at the front of the line already
 * said. Read on a real entry rather than reasoned about; it looked fine in a
 * unit test with one pair in it.
 */
export function humanise(key: string): string {
    const leaf = key.split('.').pop() ?? key;
    const spaced = leaf
        .replace(/_count$/, ' count')
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How a role reads. `SYSTEM` is not a person and should not look like one. */
export function roleLabel(role: string): string {
    switch (role) {
        case 'OPERATOR':
            return 'Operator';
        case 'CHECKIN':
            return 'Check-in';
        case 'VIEWER':
            return 'Viewer';
        case 'SYSTEM':
            return 'Trusty Track';
        default:
            return role;
    }
}
