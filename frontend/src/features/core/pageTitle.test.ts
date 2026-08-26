import { describe, expect, it } from 'vitest';
import { pageTitle, raceIdIn } from './pageTitle';

const DERBY = '2026 Pinewood Derby';

describe('pageTitle', () => {
    it('names the application on the home page', () => {
        expect(pageTitle('/')).toBe('Trusty Track');
    });

    it('names each race view, then the race', () => {
        // The distinguishing half first: a tab truncates from the right, and
        // "Trusty Track" is the part every tab already shares.
        expect(pageTitle('/race/1', DERBY)).toBe(`Roster — ${DERBY}`);
        expect(pageTitle('/race/1/standings', DERBY)).toBe(`Standings — ${DERBY}`);
        expect(pageTitle('/race/1/awards', DERBY)).toBe(`Awards — ${DERBY}`);
        expect(pageTitle('/race/1/awards/present', DERBY)).toBe(`Awards Ceremony — ${DERBY}`);
        expect(pageTitle('/race/1/stats', DERBY)).toBe(`Stats — ${DERBY}`);
        expect(pageTitle('/race/1/observation', DERBY)).toBe(`Live — ${DERBY}`);
    });

    it('follows Race Control between its own tabs — the reported bug', () => {
        // Four sub-sections behind one nav entry, and switching them is a
        // navigation the tab strip never noticed.
        expect(pageTitle('/race/1/control/schedule', DERBY)).toBe(`Schedule — ${DERBY}`);
        expect(pageTitle('/race/1/control/race', DERBY)).toBe(`Race — ${DERBY}`);
        expect(pageTitle('/race/1/control/free-race', DERBY)).toBe(`Free Race — ${DERBY}`);
        expect(pageTitle('/race/1/control/displays', DERBY)).toBe(`Displays — ${DERBY}`);
    });

    it('treats bare Race Control as the schedule, as the page itself does', () => {
        expect(pageTitle('/race/1/control', DERBY)).toBe(`Schedule — ${DERBY}`);
    });

    it('tells the free race from the race it is spelt inside', () => {
        // `/control/free-race` contains `race`, and a looser test would call
        // it the Race tab — which is how RaceControl reads the same path.
        expect(pageTitle('/race/1/control/free-race')).toBe('Free Race');
    });

    it('names the print sheets separately', () => {
        expect(pageTitle('/race/1/print', DERBY)).toBe(`Print — ${DERBY}`);
        expect(pageTitle('/race/1/print/heat-sheet', DERBY)).toBe(`Heat Sheet — ${DERBY}`);
        expect(pageTitle('/race/1/print/results', DERBY)).toBe(`Results Sheet — ${DERBY}`);
    });

    it('says the view alone while the race name is still coming', () => {
        // "Standings — undefined" would be a tab announcing a mistake; this
        // settles a moment later and nobody sees the difference.
        expect(pageTitle('/race/1/standings')).toBe('Standings');
        expect(pageTitle('/race/1/standings', null)).toBe('Standings');
    });

    it('names the pages that belong to the install rather than a race', () => {
        expect(pageTitle('/system-settings')).toBe('Settings — Trusty Track');
        expect(pageTitle('/timer-check')).toBe('Timer Check — Trusty Track');
        expect(pageTitle('/activity')).toBe('Activity — Trusty Track');
    });

    it('falls back to the application for anything unrecognised', () => {
        expect(pageTitle('/nonsense')).toBe('Trusty Track');
    });
});

describe('raceIdIn', () => {
    it('reads the race a path belongs to', () => {
        expect(raceIdIn('/race/12/control/displays')).toBe(12);
    });

    it('is null off a race page', () => {
        expect(raceIdIn('/system-settings')).toBeNull();
        expect(raceIdIn('/')).toBeNull();
    });
});
