import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * American spelling in everything a user reads (#1255).
 *
 * A regex sweep found 952 lines across 332 files spelling a handful of
 * words the British way — "colour", "licence", "grey", "chequered", and a
 * few relatives. About 85% of that is prose in code comments and
 * docstrings, which this guard deliberately does not touch (see the issue's
 * own Tier 4 and `CLAUDE.md`'s "The domain layer" for why a sweep of
 * internal prose is not attempted here). What it does check is the surface
 * a reader or an operator actually sees:
 *
 * - the docs site and the landing page (`docs/**\/*.md`, `www/*.html`) —
 *   the guides, the reference pages, the comparison table, the front door;
 * - `README.md`, rendered on GitHub;
 * - every `.tsx` file under `frontend/src` that is not a test — JSX text
 *   and the props that actually name a control for a person
 *   (`label`/`placeholder`/`title`/`aria-label`/`blurb`), the same two
 *   shapes `terminologyGuard.test.ts` already scans for "Den"/"Pack".
 *
 * A plain `.ts` helper is out of scope for the same reason it is there:
 * string literals reaching the UI through a `.ts` module are not reliably
 * delimited from ones that never render (an internal key, a GraphQL field
 * name), where JSX text and a handful of named props are unambiguous.
 *
 * Comments and docstrings are stripped before scanning, in both the `.tsx`
 * files (reusing `terminologyGuard.test.ts`'s `stripComments`) and the docs
 * (fenced and inline code spans, and a markdown link's own URL half) —
 * this guard is about what a reader or an operator sees, not about every
 * spelling of the word anywhere in the tree.
 */

const REPO_ROOT = join(process.cwd(), '..');
const SRC = join(process.cwd(), 'src');

/**
 * The British spelling and its American replacement, for reporting only —
 * the check itself just needs the word list, case-insensitive and
 * word-boundaried so "recolour" and "colourless" are caught too as long as
 * the boundary lands on a real word edge, and "denominator"-style false
 * positives don't happen ("centre" only, not every word containing it —
 * there is no English word that contains "centre" as a false-positive
 * substring the way "package" contains "pack").
 */
const WORDS = [
    'colour', 'colours',
    'licence', 'licences',
    'grey',
    'chequered',
    'behaviour', 'behaviours',
    'organisation', 'organisations',
    'centre', 'centres',
    'favourite', 'favourites',
    'catalogue', 'catalogues',
] as const;

const WORD_PATTERN = new RegExp(`\\b(${WORDS.join('|')})\\b`, 'i');
const WORD_PATTERN_G = new RegExp(`\\b(${WORDS.join('|')})\\b`, 'gi');

/**
 * Files exempted, and why — same shape as `terminologyGuard.test.ts`'s own
 * `ALLOWLIST`. Keyed relative to the repo root. Empty for now: nothing in
 * the docs or the app quotes a third party's own British spelling verbatim
 * (`docs/derbynet-timer-protocol.md` was checked by hand and has none), and
 * if one ever does, it belongs here with the reason, not silently skipped.
 */
const ALLOWLIST: Record<string, string> = {};

function stripComments(src: string): string {
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    src = src.replace(/(^|\s)\/\/.*$/gm, '');
    return src;
}

/** The two shapes `terminologyGuard.test.ts` already scans a `.tsx` file
 * for: text sitting between two JSX tags, and the props that actually name
 * a control for a person. `blurb` is added here — it is not one of
 * terminologyGuard's four, but `RaceForm.tsx`/`SystemSettings.tsx`'s
 * `ThemePicker` `blurb` prop is exactly this kind of reader-facing text
 * and #1255 found British spelling living in it. */
function findingsInTsx(src: string): string[] {
    const stripped = stripComments(src);
    const hits: string[] = [];

    for (const m of stripped.matchAll(/>([^<>]*)</g)) {
        const text = m[1].replace(/\s+/g, ' ').trim();
        if (text && WORD_PATTERN.test(text)) hits.push(text.slice(0, 100));
    }

    for (const quote of ['"', "'"] as const) {
        const re = new RegExp(
            `\\b(label|placeholder|title|aria-label|blurb)\\s*=\\s*${quote}([^${quote}]*)${quote}`,
            'g',
        );
        for (const m of stripped.matchAll(re)) {
            if (WORD_PATTERN.test(m[2])) hits.push(`${m[1]}="${m[2]}"`);
        }
    }

    for (const m of stripped.matchAll(
        /\b(label|placeholder|title|aria-label|blurb)\s*=\s*\{([^{}]*)\}/g,
    )) {
        const value = m[2].replace(/\s+/g, ' ').trim();
        if (WORD_PATTERN.test(value)) hits.push(`${m[1]}={${value.slice(0, 100)}}`);
    }

    return hits;
}

function walkTsx(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
            walkTsx(full, out);
        } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
            out.push(full);
        }
    }
}

describe('no .tsx screen spells "colour"/"licence"/"grey"/… the British way (#1255)', () => {
    const files: string[] = [];
    walkTsx(SRC, files);
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually found the tree

    for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        if (rel in ALLOWLIST) continue;

        it(`${rel} reads American spelling, not a British one`, () => {
            const hits = findingsInTsx(readFileSync(file, 'utf8'));
            expect(hits, `British spelling in ${rel}: ${hits.join(' | ')}`).toEqual([]);
        });
    }
});

/**
 * The docs site, the landing page, and README — reader-facing prose rather
 * than JSX. A fenced code block, an inline code span, and a markdown
 * link's own URL half are stripped first: none of those are prose a reader
 * reads as English, and a file path or a code sample is not this guard's
 * business.
 */
function stripNonProse(src: string): string {
    src = src.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
    src = src.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    // A markdown link's URL half: `[text](url)` -> keep `[text](` + blanks.
    src = src.replace(/\]\(([^)]*)\)/g, (m, url: string) => '](' + ' '.repeat(url.length) + ')');
    // A bare URL.
    src = src.replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
    // An HTML/markdown comment.
    src = src.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
    return src;
}

function findingsInProse(src: string): string[] {
    const stripped = stripNonProse(src);
    const hits: string[] = [];
    for (const m of stripped.matchAll(WORD_PATTERN_G)) {
        const start = Math.max(0, m.index! - 30);
        const end = Math.min(stripped.length, m.index! + m[0].length + 30);
        hits.push(stripped.slice(start, end).replace(/\s+/g, ' ').trim());
    }
    return hits;
}

/** An `.html`'s own `<script>`/`<style>` blocks and `href`/`src` attribute
 * values are not prose either — the destination of a link, or a bundler's
 * own JS, is not something a reader reads as English. */
function stripNonProseHtml(src: string): string {
    src = stripNonProse(src);
    src = src.replace(/<script[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length));
    src = src.replace(/<style[\s\S]*?<\/style>/gi, (m) => ' '.repeat(m.length));
    src = src.replace(/\b(href|src)\s*=\s*"[^"]*"/gi, (m) => ' '.repeat(m.length));
    return src;
}

function walkMarkdown(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
            walkMarkdown(full, out);
        } else if (entry.endsWith('.md')) {
            out.push(full);
        }
    }
}

describe('the docs site reads American spelling (#1255)', () => {
    const files: string[] = [];
    walkMarkdown(join(REPO_ROOT, 'docs'), files);
    expect(files.length).toBeGreaterThan(20); // sanity: the walk actually found the tree

    for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        if (rel in ALLOWLIST) continue;

        it(`${rel} reads American spelling, not a British one`, () => {
            const hits = findingsInProse(readFileSync(file, 'utf8'));
            expect(hits, `British spelling in ${rel}: ${hits.join(' | ')}`).toEqual([]);
        });
    }
});

describe('the landing page and README read American spelling (#1255)', () => {
    const targets = [
        { path: join(REPO_ROOT, 'www', 'index.html'), html: true },
        { path: join(REPO_ROOT, 'README.md'), html: false },
    ];

    for (const { path, html } of targets) {
        const rel = relative(REPO_ROOT, path);
        it(`${rel} reads American spelling, not a British one`, () => {
            const src = readFileSync(path, 'utf8');
            const hits = findingsInProse(html ? stripNonProseHtml(src) : src);
            expect(hits, `British spelling in ${rel}: ${hits.join(' | ')}`).toEqual([]);
        });
    }

    it('every allowlist entry still exists and still needs it', () => {
        for (const rel of Object.keys(ALLOWLIST)) {
            const full = join(REPO_ROOT, rel);
            const src = readFileSync(full, 'utf8');
            const hits = full.endsWith('.html')
                ? findingsInProse(stripNonProseHtml(src))
                : full.endsWith('.tsx')
                    ? findingsInTsx(src)
                    : findingsInProse(src);
            expect(hits.length, `${rel} is allowlisted but has nothing to allow any more — remove the entry`).toBeGreaterThan(0);
        }
    });
});

/**
 * A small plant-and-scan self-test, in the same spirit as
 * `terminologyGuard.test.ts`'s own — proof the matchers actually catch the
 * shapes they claim to, not just the words this sweep happened to find.
 */
describe('findingsInTsx and findingsInProse catch every shape this guard claims to', () => {
    it('plain JSX text', () => {
        expect(findingsInTsx('<span>Lane Colour</span>')).toEqual(['Lane Colour']);
    });

    it('a label prop', () => {
        expect(findingsInTsx('<input label="Favourite colour" />')).toEqual([
            'label="Favourite colour"',
        ]);
    });

    it('a blurb prop in braces', () => {
        expect(
            findingsInTsx('<ThemePicker blurb={`Pit passes and licences`} />'),
        ).toEqual(['blurb={`Pit passes and licences`}']);
    });

    it('does not fire on an ordinary American screen', () => {
        expect(findingsInTsx('<button title="Lane color">{label}</button>')).toEqual([]);
    });

    it('does not fire on a comment', () => {
        expect(findingsInTsx('// this comment says colour on purpose\n<span>ok</span>')).toEqual([]);
    });

    it('prose in a markdown paragraph', () => {
        expect(findingsInProse('Match the lane to its colour.').length).toBe(1);
    });

    it('a fenced code block is not prose', () => {
        expect(findingsInProse('```\nconst colour = 1;\n```').length).toBe(0);
    });

    it('an inline code span is not prose', () => {
        expect(findingsInProse('Set `laneColour` in the config.').length).toBe(0);
    });

    it("a markdown link's own URL half is not prose", () => {
        expect(findingsInProse('[Lane colors](reference/race-settings.md#lane-colours)').length).toBe(0);
    });
});
