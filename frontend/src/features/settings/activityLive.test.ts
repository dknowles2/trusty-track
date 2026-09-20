import { describe, expect, it } from 'vitest';
import { applyPendingEntries, pendingSince, readLiveSetting, writeLiveSetting } from './activityLive';
import type { LogEntry } from './activityLog';

const entry = (id: number): LogEntry => ({
    id,
    at: '2026-09-13T12:00:00Z',
    action: 'createRace',
    role: 'OPERATOR',
    outcome: 'OK',
    summary: `Entry ${id}`,
    noteworthy: false,
});

/** A tiny in-memory stand-in for `localStorage`, so a test can pin exactly what was read or written. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
    const store = { ...initial };
    return {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            for (const key of Object.keys(store)) delete store[key];
        },
        key: () => null,
        length: 0,
    } as Storage;
}

describe('readLiveSetting / writeLiveSetting', () => {
    it('is off by default, like the chime', () => {
        expect(readLiveSetting(fakeStorage())).toBe(false);
    });

    it('reads back what was written — the same shape a remount reads on reload', () => {
        const storage = fakeStorage();
        writeLiveSetting(true, storage);
        expect(readLiveSetting(storage)).toBe(true);

        writeLiveSetting(false, storage);
        expect(readLiveSetting(storage)).toBe(false);
    });

    it('treats anything other than the exact "on" string as off', () => {
        expect(readLiveSetting(fakeStorage({ 'trustytrack.activityLive': 'true' }))).toBe(false);
        expect(readLiveSetting(fakeStorage({ 'trustytrack.activityLive': '' }))).toBe(false);
    });

    it('never throws when storage refuses to cooperate', () => {
        const angry: Pick<Storage, 'getItem'> = {
            getItem: () => {
                throw new Error('storage is disabled');
            },
        };
        expect(readLiveSetting(angry)).toBe(false);

        const angrySet: Pick<Storage, 'setItem'> = {
            setItem: () => {
                throw new Error('storage is disabled');
            },
        };
        expect(() => writeLiveSetting(true, angrySet)).not.toThrow();
    });
});

describe('pendingSince', () => {
    it('is empty when the fetched page holds nothing new', () => {
        const loaded = [entry(3), entry(2), entry(1)];
        expect(pendingSince(loaded, [entry(3), entry(2)])).toEqual([]);
    });

    it('reports entries the fetched page has that loaded does not, in the fetched order', () => {
        const loaded = [entry(3), entry(2), entry(1)];
        const fetched = [entry(5), entry(4), entry(3), entry(2)];
        expect(pendingSince(loaded, fetched)).toEqual([entry(5), entry(4)]);
    });

    it('is the whole fetched page the first time, when nothing is loaded yet', () => {
        expect(pendingSince([], [entry(2), entry(1)])).toEqual([entry(2), entry(1)]);
    });

    it('honours a matchesFilter predicate (#1253), excluding entries the current filter would not show', () => {
        const loaded = [entry(1)];
        const fetched = [entry(4), entry(3), entry(2), entry(1)];
        const onlyEven = (candidate: LogEntry) => candidate.id % 2 === 0;
        expect(pendingSince(loaded, fetched, onlyEven)).toEqual([entry(4), entry(2)]);
    });

    it('defaults to "everything matches" when no predicate is given', () => {
        const loaded: LogEntry[] = [];
        const fetched = [entry(2), entry(1)];
        expect(pendingSince(loaded, fetched)).toEqual(pendingSince(loaded, fetched, () => true));
    });
});

describe('applyPendingEntries', () => {
    it('does nothing when there is no pending', () => {
        const loaded = [entry(2), entry(1)];
        expect(applyPendingEntries(loaded, [])).toEqual(loaded);
    });

    it('prepends pending entries ahead of what is loaded, newest first', () => {
        const loaded = [entry(2), entry(1)];
        const pending = [entry(4), entry(3)];
        expect(applyPendingEntries(loaded, pending)).toEqual([entry(4), entry(3), entry(2), entry(1)]);
    });

    it('does not duplicate an entry pending already reports as loaded', () => {
        // Defensive: `pendingSince` should never produce this, but a caller
        // that has since fetched again first must not double an entry up.
        const loaded = [entry(3), entry(2), entry(1)];
        const pending = [entry(4), entry(3)];
        expect(applyPendingEntries(loaded, pending)).toEqual([entry(4), entry(3), entry(2), entry(1)]);
    });

    it('preserves entries loaded from older pages — applying pending never drops them', () => {
        // The regression this exists to prevent: an operator who clicked
        // "Load older entries" must keep seeing them once new entries land.
        const loadedWithOlderPage = [entry(3), entry(2), entry(1), entry(0)];
        expect(applyPendingEntries(loadedWithOlderPage, [entry(4)])).toEqual([
            entry(4),
            entry(3),
            entry(2),
            entry(1),
            entry(0),
        ]);
    });
});
