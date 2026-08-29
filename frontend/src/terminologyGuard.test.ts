import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The fiftieth file gets missed (#496 stage 4).
 *
 * Every screen under `src/features` is supposed to say "Den" and "Pack"
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
 */

const SRC = resolve_src();

function resolve_src(): string {
    // vitest's cwd is the frontend package root.
    return join(process.cwd(), 'src', 'features');
}

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
 */
const ALLOWLIST: Record<string, string> = {
    'settings/pages/SystemSettings.tsx':
        'The terminology *setting* itself. Its labels name the built-in words ' +
        'an operator is choosing to replace ("One racing group (was “Den”)") — ' +
        'that is describing the setting, not display copy the setting controls.',
    'management/components/RacingGroupManager.tsx':
        'The racing group\'s Category field is free text for everyone (#496 ' +
        'stage 2 — division stays a fixed label, not a configurable term), and ' +
        'its placeholder ("e.g. Wolf, 3rd Grade") is only an example of what ' +
        'goes there, the same as any other example placeholder in the app.',
    'awards/components/AwardForm.tsx':
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

    // Text sitting directly between two JSX tags: `>...text...<`.
    for (const m of stripped.matchAll(/>([^<>{}]*)</g)) {
        const text = m[1].trim();
        if (text && WORD_PATTERN.test(text)) hits.push(text.slice(0, 100));
    }

    // The props that actually name a control for a person.
    for (const quote of ['"', "'"] as const) {
        const re = new RegExp(
            `\\b(label|placeholder|title|aria-label)\\s*=\\s*${quote}([^${quote}]*)${quote}`,
            'g',
        );
        for (const m of stripped.matchAll(re)) {
            if (WORD_PATTERN.test(m[2])) hits.push(`${m[1]}="${m[2]}"`);
        }
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
    walk(SRC, files);
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
