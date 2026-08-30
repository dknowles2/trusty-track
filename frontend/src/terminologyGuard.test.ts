import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The fiftieth file gets missed (#496 stage 4).
 *
 * Every screen under `src/features` (and, as of #532, `src/components`,
 * `src/context` and `src/theming`) is supposed to say "Den" and "Pack"
 * through `useTerminology()` now, not as a literal. Nothing stops a future
 * change from typing the word straight into JSX again — the mistake this
 * whole stage existed to fix, four different ways, before this guard
 * existed (`RacingGroupManager`'s alerts, `ImportRacersModal`'s template
 * CSV, `describeSpeedAward`'s "no longer exists" fallback, the roster's
 * bulk-move buttons). Same spirit as `test_heat_lanes_write.py` walking the
 * backend AST to prove nothing but `crud.set_heat_lanes` writes a lane: make
 * the mistake unbuildable rather than trusting a reviewer to catch it.
 *
 * Scoped to `.tsx` (JSX is where an operator actually reads the word) and to
 * two shapes: text sitting between JSX tags, and the `label` / `placeholder`
 * / `title` / `aria-label` props that name a control. A pure `.ts` helper
 * (`awardText.ts`, `resultsSheet.ts`, `setupChecklist.ts`, …) takes its words
 * as a parameter instead of importing `useTerminology()` — see each file's
 * own doc comment — so there is nothing in `.ts` for this to check; its
 * *callers*, which are `.tsx`, are what this scans.
 *
 * `OTHER` is deliberately not one of the seven rank words checked below —
 * unlike `Lion`/`Wolf`/`Webelos`, it is an ordinary English word this app
 * uses for unrelated things ("Other" in a generic picker), and flagging it
 * would be noise a reviewer learns to ignore rather than a real signal.
 *
 * #532: both shapes above stopped at the first `{`, so a hardcode sitting
 * inside a JSX interpolation was invisible to either — not a corner case, but
 * the shape a regression naturally takes, since a developer writing `{n}
 * racers` is exactly the developer about to hand-write the noun beside it.
 * `findingsIn` now scans the full run between two tags, braces included, and
 * a `prop={...}` alongside the plain-quoted `prop="..."` it already checked.
 * See "what the matchers now catch" below for the shapes pinned against it.
 */

const SRC = resolve_src();

function resolve_src(): string {
    // vitest's cwd is the frontend package root.
    return join(process.cwd(), 'src');
}

/**
 * Directories an operator's screen can live under. `gql/` is generated,
 * `utils/`, `api/` and the other pure-`.ts` homes hold no JSX (see the module
 * doc comment on why `.ts` is out of scope), and the rest of `src` — `App.tsx`
 * aside — is routing and build plumbing. `components/`, `context/` and
 * `theming/` held no violation when this list was widened (#532); they are
 * scanned now so the next one written there does not go unseen the way
 * `RaceExecution.tsx` and `sections.ts` did.
 */
const SCAN_ROOTS = ['features', 'components', 'context', 'theming'] as const;

/** Den/Pack, both cases (a sentence can use either mid-clause), and the six
 * Cub Scout ranks specific enough to be worth flagging — see the module doc
 * comment for why `OTHER` is not among them. `Webelos` covers `ARROW_OF_LIGHT`
 * too badly, so that one is spelled out as its own two-word phrase. */
const WORDS = [
    'Den', 'Dens', 'den', 'dens',
    'Pack', 'Packs', 'pack', 'packs',
    'Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos',
    'Arrow of Light',
] as const;

const WORD_PATTERN = new RegExp(
    `\\b(${WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`,
);

/**
 * Files exempted, and why. Every entry here is a conscious decision, not an
 * oversight — a new one added without a reason is the thing this guard
 * exists to make somebody stop and explain.
 *
 * Keyed relative to `src` (not `src/features`) now that the scan spans more
 * than one top-level directory — `features/settings/pages/SystemSettings.tsx`
 * rather than `settings/pages/SystemSettings.tsx`, so a `components/` or
 * `context/` entry cannot collide with a `features/` one of the same name.
 */
const ALLOWLIST: Record<string, string> = {
    'features/settings/pages/SystemSettings.tsx':
        'The terminology *setting* itself. Its labels name the built-in words ' +
        'an operator is choosing to replace ("One racing group (was “Den”)") — ' +
        'that is describing the setting, not display copy the setting controls.',
    'features/management/components/RacingGroupManager.tsx':
        'The racing group\'s Category field is free text for everyone (#496 ' +
        'stage 2 — division stays a fixed label, not a configurable term), and ' +
        'its placeholder ("e.g. Wolf, 3rd Grade") is only an example of what ' +
        'goes there, the same as any other example placeholder in the app.',
    'features/awards/components/AwardForm.tsx':
        'The award name placeholder ("e.g. Best Paint, Fastest Wolf") is an ' +
        'example of a plausible award name, not the racing-group/organization ' +
        'vocabulary — "Wolf" here names an example division, per the reason ' +
        'above.',
};

function stripComments(src: string): string {
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    src = src.replace(/(^|\s)\/\/.*$/gm, '');
    return src;
}

function findingsIn(src: string): string[] {
    const stripped = stripComments(src);
    const hits: string[] = [];

    // Text sitting between two JSX tags: `>...<`. Braces are no longer
    // excluded from the run — a hardcoded word inside an interpolation
    // (`{n} racers to a Den`, or a ternary's string branch) is exactly as
    // visible to the operator as one sitting in plain text, so the whole run
    // is tested as one string rather than skipped the moment it contains a
    // `{`. The one thing still excluded is another tag: this is deliberately
    // not a JSX parser, only a scan of what sits between two of them.
    //
    // Whitespace is collapsed before testing, not just trimmed at the ends —
    // a stripped-out comment (see `stripComments`) leaves a run of blank
    // characters in the *middle* of the text, which plain `.trim()` does not
    // touch, and a real hit's reported message was previously a wall of
    // spaces with the actual word past the 100-character slice.
    for (const m of stripped.matchAll(/>([^<>]*)</g)) {
        const text = m[1].replace(/\s+/g, ' ').trim();
        if (text && WORD_PATTERN.test(text)) hits.push(text.slice(0, 100));
    }

    // The props that actually name a control for a person, as a plain quoted
    // string: `title="Move to Den"`.
    for (const quote of ['"', "'"] as const) {
        const re = new RegExp(
            `\\b(label|placeholder|title|aria-label)\\s*=\\s*${quote}([^${quote}]*)${quote}`,
            'g',
        );
        for (const m of stripped.matchAll(re)) {
            if (WORD_PATTERN.test(m[2])) hits.push(`${m[1]}="${m[2]}"`);
        }
    }

    // The same props as a brace expression — a template literal, a quoted
    // string, or a ternary between two of them: `title={`Move to Den`}`,
    // `placeholder={'Sort by Den'}`, `aria-label={cond ? 'Pick a Pack' : x}`.
    // All are ordinary React and were previously invisible: the pattern above
    // demands a literal quote immediately after `=`. One level of braces —
    // no nested object literal — covers every shape #532 planted; a prop
    // whose expression holds a nested `{}` is rare enough for these four
    // names that widening further is not worth the false-positive risk.
    for (const m of stripped.matchAll(
        /\b(label|placeholder|title|aria-label)\s*=\s*\{([^{}]*)\}/g,
    )) {
        const value = m[2].replace(/\s+/g, ' ').trim();
        if (WORD_PATTERN.test(value)) hits.push(`${m[1]}={${value.slice(0, 100)}}`);
    }

    return hits;
}

function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const info = statSync(full);
        if (info.isDirectory()) {
            walk(full, out);
        } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
            out.push(full);
        }
    }
}

describe('no screen hardcodes "Den"/"Pack"/a Cub Scout rank (#496 stage 4)', () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(join(SRC, root), files);
    expect(files.length).toBeGreaterThan(40); // sanity: the walk actually found the tree

    for (const file of files) {
        const rel = relative(SRC, file);
        if (rel in ALLOWLIST) continue;

        it(`${rel} reads the resolved terminology, not a literal`, () => {
            const hits = findingsIn(readFileSync(file, 'utf8'));
            expect(hits, `hardcoded vocabulary in ${rel}: ${hits.join(' | ')}`).toEqual([]);
        });
    }

    it('every allowlist entry still exists and still needs it', () => {
        for (const rel of Object.keys(ALLOWLIST)) {
            const full = join(SRC, rel);
            expect(files, `${rel} is allowlisted but no longer exists — remove the entry`).toContain(full);
            const hits = findingsIn(readFileSync(full, 'utf8'));
            expect(hits.length, `${rel} is allowlisted but has nothing to allow any more — remove the entry`).toBeGreaterThan(0);
        }
    });
});

/**
 * Issue #532's plant-and-scan experiment, pinned rather than left as a
 * throwaway file: five violations, each a shape the old matchers missed
 * because a `{` stopped them. Every one must be caught here so the coverage
 * cannot silently regress the way the original guard's did.
 */
describe('findingsIn catches every shape #532 planted', () => {
    it('plain JSX text (already caught before #532)', () => {
        expect(findingsIn('<span>Wolf</span>')).toEqual(['Wolf']);
    });

    it('JSX text with an interpolation mixed in', () => {
        expect(findingsIn('<p>Move {n} racers to a Den</p>')).toEqual([
            'Move {n} racers to a Den',
        ]);
    });

    it('a template literal in braces', () => {
        expect(findingsIn('<button title={`Move to Den`}>Go</button>')).toEqual([
            'title={`Move to Den`}',
        ]);
    });

    it('a single-quoted string in braces', () => {
        expect(findingsIn("<input placeholder={'Sort by Den'} />")).toEqual([
            "placeholder={'Sort by Den'}",
        ]);
    });

    it('a double-quoted string in braces', () => {
        expect(findingsIn('<button aria-label={"Pick a Pack"} />')).toEqual([
            'aria-label={"Pick a Pack"}',
        ]);
    });

    it('a ternary between two string branches in braces', () => {
        const hits = findingsIn(
            "<div title={isAll ? 'the whole pack' : 'each den'} />",
        );
        expect(hits).toEqual(["title={isAll ? 'the whole pack' : 'each den'}"]);
    });

    it('still says nothing about an ordinary screen', () => {
        expect(
            findingsIn('<button title={`Move to ${group}`}>{count} racers</button>'),
        ).toEqual([]);
    });

    it('does not fire on a longer identifier that merely contains a word', () => {
        // \b enforces a real word boundary — "denominator" and "package" are
        // not "den" or "pack" wearing a disguise.
        expect(findingsIn('<p>{denominator} of the package total</p>')).toEqual([]);
    });
});
