import { describe, expect, it } from 'vitest';
import docsLinks from './docsLinks.json';
import { DOCS_BASE, docsHref, docsTitle, type DocsKey } from './docsLink';

const KEYS = Object.keys(docsLinks) as DocsKey[];

describe('docsHref', () => {
    it('has exactly one base and a trailing slash before any #anchor', () => {
        expect(KEYS.length).toBeGreaterThan(0);
        for (const key of KEYS) {
            const href = docsHref(key);
            expect(href.startsWith(DOCS_BASE)).toBe(true);
            // Exactly one occurrence of the base — no doubled prefix from a
            // path that itself started with the base or a leading slash.
            expect(href.split(DOCS_BASE).length - 1).toBe(1);
            const [beforeHash] = href.split('#');
            expect(beforeHash.endsWith('/')).toBe(true);
        }
    });

    it('every key resolves to a non-empty href and title', () => {
        for (const key of KEYS) {
            expect(docsHref(key).length).toBeGreaterThan(DOCS_BASE.length);
            expect(docsTitle(key)).not.toBe('');
        }
    });

    it('appends the anchor when the entry has one, and omits the # otherwise', () => {
        const withAnchor = KEYS.find((k) => (docsLinks as Record<string, { anchor?: string }>)[k].anchor);
        const withoutAnchor = KEYS.find((k) => !(docsLinks as Record<string, { anchor?: string }>)[k].anchor);
        expect(withAnchor).toBeDefined();
        expect(withoutAnchor).toBeDefined();
        if (withAnchor) {
            const entry = (docsLinks as Record<string, { anchor?: string }>)[withAnchor];
            expect(docsHref(withAnchor)).toBe(`${DOCS_BASE}${(docsLinks as Record<string, { path: string }>)[withAnchor].path}/#${entry.anchor}`);
        }
        if (withoutAnchor) {
            expect(docsHref(withoutAnchor)).not.toContain('#');
        }
    });
});

describe('docsLinks.json shape', () => {
    it('no path starts with "/", starts with "docs/", or ends with "/"', () => {
        for (const key of KEYS) {
            const { path } = (docsLinks as Record<string, { path: string }>)[key];
            expect(path.startsWith('/'), `${key}'s path ${path} starts with /`).toBe(false);
            expect(path.startsWith('docs/'), `${key}'s path ${path} starts with docs/`).toBe(false);
            expect(path.endsWith('/'), `${key}'s path ${path} ends with /`).toBe(false);
        }
    });
});
