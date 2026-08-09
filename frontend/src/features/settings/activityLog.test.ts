import { describe, expect, it } from 'vitest';
import { byDay, detailPairs, humanise, localDay, roleLabel, type LogEntry } from './activityLog';

const entry = (over: Partial<LogEntry> & { id: number; at: string }): LogEntry => ({
    action: 'createRace',
    role: 'OPERATOR',
    outcome: 'OK',
    summary: 'Created a race',
    noteworthy: false,
    ...over,
});

describe('localDay', () => {
    it('groups on the reader’s own day, not on UTC', () => {
        // Entries are stored in UTC. Slicing the string would put an evening's
        // racing under two headings for anyone west of Greenwich, which is
        // most of the people this app is written for.
        const late = new Date(2026, 7, 9, 23, 30).toISOString();

        expect(localDay(late)).toBe('2026-08-09');
    });

    it('survives a timestamp it cannot parse', () => {
        // Falls back to the leading date-shaped portion rather than throwing.
        expect(localDay('rubbish-value-here')).toBe('rubbish-va');
    });
});

describe('byDay', () => {
    const now = new Date(2026, 7, 9, 12, 0, 0);

    it('labels the current day', () => {
        const sections = byDay([entry({ id: 1, at: new Date(2026, 7, 9, 9).toISOString() })], now);

        expect(sections[0].label).toBe('Today');
    });

    it('labels the day before', () => {
        const sections = byDay([entry({ id: 1, at: new Date(2026, 7, 8, 9).toISOString() })], now);

        expect(sections[0].label).toBe('Yesterday');
    });

    it('writes out anything older', () => {
        const sections = byDay([entry({ id: 1, at: new Date(2026, 6, 4, 9).toISOString() })], now);

        expect(sections[0].label).not.toBe('Today');
        expect(sections[0].label).toMatch(/July/);
    });

    it('keeps the order it was given, which is newest first', () => {
        const sections = byDay(
            [
                entry({ id: 3, at: new Date(2026, 7, 9, 11).toISOString() }),
                entry({ id: 2, at: new Date(2026, 7, 9, 10).toISOString() }),
                entry({ id: 1, at: new Date(2026, 7, 8, 10).toISOString() }),
            ],
            now,
        );

        expect(sections.map((s) => s.label)).toEqual(['Today', 'Yesterday']);
        expect(sections[0].entries.map((e) => e.id)).toEqual([3, 2]);
    });

    it('starts a new section when the day changes back', () => {
        // Defensive: a page that assumed sorted input would silently merge two
        // separate days into one heading.
        const sections = byDay(
            [
                entry({ id: 3, at: new Date(2026, 7, 9, 11).toISOString() }),
                entry({ id: 2, at: new Date(2026, 7, 8, 10).toISOString() }),
                entry({ id: 1, at: new Date(2026, 7, 9, 9).toISOString() }),
            ],
            now,
        );

        expect(sections.map((s) => s.day)).toEqual(['2026-08-09', '2026-08-08', '2026-08-09']);
    });

    it('produces nothing from nothing', () => {
        expect(byDay([], now)).toEqual([]);
    });
});

describe('detailPairs', () => {
    it('unpacks what was stored', () => {
        expect(detailPairs('{"race.name": "Derby"}')).toEqual([
            { label: 'Name', value: 'Derby' },
        ]);
    });

    it('is empty when there is nothing stored', () => {
        expect(detailPairs(null)).toEqual([]);
        expect(detailPairs('')).toEqual([]);
    });

    it('never throws on a malformed row', () => {
        // An audit log is exactly what somebody reads after something went
        // wrong; a page that failed on one bad row would hide the nine hundred
        // good ones around it.
        expect(detailPairs('{not json')).toEqual([]);
        expect(detailPairs('[1,2,3]')).toEqual([]);
        expect(detailPairs('"a string"')).toEqual([]);
    });

    it('renders a number as text rather than dropping it', () => {
        expect(detailPairs('{"heatId": 4}')).toEqual([{ label: 'Heat id', value: '4' }]);
    });
});

describe('humanise', () => {
    it('drops the object prefix, which every pair on a line repeats', () => {
        // A mutation takes one input object, so the prefix was half the text
        // saying what the action at the front of the line already said.
        expect(humanise('race.carNumberingStrategy')).toBe('Car numbering strategy');
    });

    it('reads a count suffix as a word', () => {
        expect(humanise('racerIds_count')).toBe('Racer ids count');
    });

    it('leaves a plain key alone but for its capital', () => {
        expect(humanise('id')).toBe('Id');
    });
});

describe('roleLabel', () => {
    it('names the roles', () => {
        expect(roleLabel('OPERATOR')).toBe('Operator');
        expect(roleLabel('CHECKIN')).toBe('Check-in');
    });

    it('does not make the app look like a person', () => {
        // SYSTEM is the timer recording a heat it just ran. "System" in a
        // "who did this" column reads as a user account.
        expect(roleLabel('SYSTEM')).toBe('Trusty Track');
    });

    it('shows an unknown role rather than hiding it', () => {
        expect(roleLabel('FUTURE')).toBe('FUTURE');
    });
});
