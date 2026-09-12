// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { clearLastRace, readLastRace, writeLastRace } from './lastRace';

describe('lastRace', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('reads null when nothing has been remembered', () => {
        expect(readLastRace()).toBeNull();
    });

    it('round-trips a race written earlier', () => {
        writeLastRace({ id: 7, name: 'Practice Race' });
        expect(readLastRace()).toEqual({ id: 7, name: 'Practice Race' });
    });

    it('forgets a race once cleared', () => {
        writeLastRace({ id: 7, name: 'Practice Race' });
        clearLastRace();
        expect(readLastRace()).toBeNull();
    });

    it('overwrites whatever was remembered before', () => {
        writeLastRace({ id: 7, name: 'Practice Race' });
        writeLastRace({ id: 9, name: '2026 Pinewood Derby' });
        expect(readLastRace()).toEqual({ id: 9, name: '2026 Pinewood Derby' });
    });

    // A build that shaped this differently, or storage tampered with by hand,
    // must degrade to "nothing remembered" rather than a crash — the same
    // rule `readAppTheme` and `readPin` follow.
    it('falls back to null for a garbled value', () => {
        window.localStorage.setItem('trustytrack.lastRace', 'not json');
        expect(readLastRace()).toBeNull();
    });

    it('falls back to null for a value missing a field', () => {
        window.localStorage.setItem('trustytrack.lastRace', JSON.stringify({ id: 7 }));
        expect(readLastRace()).toBeNull();
    });

    it('falls back to null for a value shaped as something else entirely', () => {
        window.localStorage.setItem('trustytrack.lastRace', JSON.stringify([1, 2, 3]));
        expect(readLastRace()).toBeNull();
    });
});
