import { describe, expect, it } from 'vitest';
import { activeNavLink } from './activeNavLink';

const LINKS = [
    { to: '/race/1' },
    { to: '/race/1/control' },
    { to: '/race/1/standings' },
    { to: '/race/1/awards' },
    { to: '/race/1/stats' },
    { to: '/race/1/observation' },
];

describe('activeNavLink', () => {
    it('matches a link exactly', () => {
        expect(activeNavLink('/race/1/control', LINKS)).toBe('/race/1/control');
    });

    it('a Control sub-section is Control — the reported bug', () => {
        expect(activeNavLink('/race/1/control/schedule', LINKS)).toBe('/race/1/control');
        expect(activeNavLink('/race/1/control/displays', LINKS)).toBe('/race/1/control');
        expect(activeNavLink('/race/1/control/free-race', LINKS)).toBe('/race/1/control');
    });

    it('the roster link does not light up on every race page', () => {
        // `/race/1` is a prefix of everything; the longest match wins.
        expect(activeNavLink('/race/1/standings', LINKS)).toBe('/race/1/standings');
    });

    it('the roster page itself is Roster', () => {
        expect(activeNavLink('/race/1', LINKS)).toBe('/race/1');
    });

    it('pages under no deeper link fall to Roster, where their button lives', () => {
        expect(activeNavLink('/race/1/print', LINKS)).toBe('/race/1');
        expect(activeNavLink('/race/1/print/heat-sheet', LINKS)).toBe('/race/1');
    });

    it('a race id that merely starts the same is not a sub-path', () => {
        expect(activeNavLink('/race/12', [{ to: '/race/1' }])).toBeNull();
    });

    it('off the row entirely, nothing is active', () => {
        expect(activeNavLink('/system-settings', LINKS)).toBeNull();
    });
});
