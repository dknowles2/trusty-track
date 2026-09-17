import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import docsLinks from './docs/docsLinks.json';

/**
 * Two ways a docs link can go stale, mirrored from `terminologyGuard.test.ts`'s
 * own reasoning: a screen that is supposed to have a `?` icon and does not
 * (#1194's whole point — the issue that started this was exactly one page
 * linking to the docs, twice, everywhere else silent), and a `docsLinks.json`
 * entry nobody ever links to, which is stale documentation about the app's
 * own screens rather than about the product.
 */

const SRC = resolve_src();

function resolve_src(): string {
    // vitest's cwd is the frontend package root.
    return join(process.cwd(), 'src');
}

/**
 * Every page from #1194's own placement list — "the page header of every
 * major screen" — an explicit enumeration rather than a directory walk, the
 * same shape `terminologyGuard.test.ts`'s `SCAN_ROOTS` takes at the
 * directory level: a new page is not implicitly covered by being added
 * somewhere under `features/`, it has to be added here too.
 */
const PAGES_WITH_A_DOCS_LINK = [
    'features/management/pages/RaceDetails.tsx',
    'features/racing/pages/RaceControl.tsx',
    'features/stats/components/Leaderboard.tsx',
    'features/awards/pages/Awards.tsx',
    'features/stats/pages/RaceStats.tsx',
    'features/printables/pages/Printables.tsx',
    'features/observation/pages/DisplaysPage.tsx',
    'features/settings/pages/SystemSettings.tsx',
    'features/settings/pages/TimerDiagnostics.tsx',
    'features/settings/components/TrackCard.tsx',
    'features/settings/pages/ActivityLog.tsx',
    'features/camera/pages/Camera.tsx',
] as const;

describe('every major screen carries a DocsLink (#1194)', () => {
    for (const rel of PAGES_WITH_A_DOCS_LINK) {
        it(`${rel} renders <DocsLink`, () => {
            const full = join(SRC, rel);
            const src = readFileSync(full, 'utf8');
            expect(src.includes('<DocsLink'), `${rel} has no <DocsLink`).toBe(true);
        });
    }
});

// ---------------------------------------------------------------------------
// Every docsKey used in the tree names a real entry, and every entry is used.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        if (entry === 'gql') continue; // generated
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
            walk(full, out);
        } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
            out.push(full);
        }
    }
}

/** `docsKey="foo"` or `docsKey={'foo'}` / `docsKey={"foo"}` — `DocsLink` and
 * `FieldHelp`'s `docs` prop are both plain string literals everywhere in the
 * tree, never a computed value, except `RaceControl.tsx`'s tab-keyed lookup
 * (`docsKeyForTab[viewMode]`), which is checked separately below. */
const DOCS_KEY_LITERAL = /\b(?:docsKey|docs)\s*=\s*(?:\{)?['"]([a-z0-9-]+)['"]/g;

function docsKeysIn(src: string): string[] {
    return [...src.matchAll(DOCS_KEY_LITERAL)].map((m) => m[1]);
}

describe('docsKey usage matches docsLinks.json in both directions', () => {
    const files: string[] = [];
    walk(SRC, files);
    expect(files.length).toBeGreaterThan(40); // sanity: the walk found the tree

    const knownKeys = new Set(Object.keys(docsLinks));
    const usedKeys = new Set<string>();
    // `RaceControl.tsx`'s `docsKeyForTab` and `SystemSettings.tsx`'s
    // `SECTION_DOCS_KEY` are lookup records keyed by tab/section id, so the
    // `docsKey={record[value]}` they pass is not a string literal the regex
    // above can see — named here so the "every key is used" half still
    // credits them. `settings-general` through `settings-backup` mirror
    // `SectionId` exactly (`sections.ts`'s `SECTIONS`), which is what
    // `SystemSettings.test.tsx` and `sections.test.ts` hold constant.
    usedKeys.add('control-schedule');
    usedKeys.add('control-race');
    usedKeys.add('control-free-race');
    usedKeys.add('settings-general');
    usedKeys.add('settings-appearance');
    usedKeys.add('settings-access');
    usedKeys.add('settings-tracks');
    usedKeys.add('settings-advanced');
    usedKeys.add('settings-backup');

    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        for (const key of docsKeysIn(src)) {
            usedKeys.add(key);
            if (!knownKeys.has(key)) {
                it(`${file.slice(SRC.length + 1)} uses unknown docsKey ${key}`, () => {
                    expect(knownKeys.has(key)).toBe(true);
                });
            }
        }
    }

    it('every key named in the tree is a real entry in docsLinks.json', () => {
        // If the loop above found nothing to flag, there is nothing more to
        // assert here — a failure would already have been raised as its own
        // `it()` inside the loop, which reports the offending file by name.
        expect(true).toBe(true);
    });

    for (const key of knownKeys) {
        it(`docsLinks.json['${key}'] is used somewhere in src/`, () => {
            expect(usedKeys.has(key), `${key} is in docsLinks.json but nothing links to it`).toBe(true);
        });
    }
});
