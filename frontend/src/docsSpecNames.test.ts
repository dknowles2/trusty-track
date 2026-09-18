import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every unique name a docs screenshot spec creates goes through `attemptName`
 * (#1219). `races.name` is unique on the one backend the whole suite shares,
 * and `tracks.name` — while not a database constraint — is how several specs
 * find "their own" track back (`ownTrack`'s callers, `screenshot-timers.spec.ts`'s
 * card lookup); a retry that re-seeds under the same name a failed first
 * attempt used is guaranteed to fail with a constraint violation (a race) or a
 * locator resolving to two elements (a track), defeating the very recovery a
 * retry exists to provide. #829 fixed this for tracks alone, in four specs
 * that each hand-rolled their own `retry > 0 ? … : …` ternary; #1219 is every
 * other name, through one shared helper (`e2e/docs/support.ts`'s
 * `attemptName`).
 *
 * `frontend/vite.config.ts`'s vitest `test.exclude` carries `**\/e2e/**`, so
 * this lives under `src/` beside `terminologyGuard.test.ts` (the same shape
 * of guard — an AST-adjacent scan of a directory the test runner otherwise
 * never reads) rather than in `e2e/docs/` itself, and reads the specs by path.
 *
 * This is deliberately **not** a scan of every `name:` in these files — most
 * of them (`page.getByRole('heading', { name: … })`, a racer's `carName`, an
 * award's `name`, a racing group's `name`) are either not a database field at
 * all or one with no uniqueness to defend, and flagging them would need an
 * allowlist the size of the directory. Instead this walks the four shapes a
 * docs spec actually uses to create a race or a track:
 *
 *   1. `race: { name: '…', … }` / `track: { name: '…', … }` — the object a
 *      raw `gql(page, 'mutation … { createRace(race: $race) … }', { race: {…} })`
 *      call sends, found by matching `name:` at the object's own top level
 *      (curly depth 1 from the object's opening brace, not inside a nested
 *      `[…]` array) — which is what lets a nested `racingGroups: [{ name: … }]`
 *      inside a `race: {…}` (`screenshot-first-run.spec.ts`'s "copy from last
 *      year" race) go unflagged **structurally**, without needing an
 *      allowlist entry: `RacingGroup.name` carries no uniqueness constraint
 *      (`backend/db/models.py`), so a racing group's own name is exactly the
 *      "not unique" case this guard has no business flagging.
 *   2. `seedRace(page, { name: '…', … })` — `support.ts`'s helper, the same
 *      object shape as 1 without the `race:` key wrapping it.
 *   3. `ownTrack(page, <name>, …)` — the name is a positional argument, not
 *      an object key, so this is matched separately.
 *   4. A `name:` (or `ownTrack`'s positional argument) whose value is an
 *      *identifier* rather than a literal — every retry-suffixed track goes
 *      through `const trackName = attemptName('…')` first, because the
 *      variable is reused elsewhere (passed to `ownTrack`, read back into a
 *      caption, or both) — is resolved one level, to that identifier's own
 *      `const`/`let` declaration, and *that* is checked for the wrap.
 *   5. A top-level `...ident` spread inside one of these objects — `seedRace(page,
 *      { ...overrides, dateTime })`, `race: { ...base, trackId }` — which would
 *      otherwise hide a `name:` from shapes 1/2 entirely: the key search only
 *      looks for a literal `name:` token, and a spread has none. Resolved the
 *      same one level as shape 4 (`overrides`'s own `const` declaration); if
 *      that resolves to an object with its own top-level `name:`, that name is
 *      checked for the wrap. If it can't be resolved — a spread of a call
 *      result, a function parameter, or a declaration two levels away — this is
 *      reported rather than silently passed, since a future spec is exactly as
 *      likely to reach for this shape as for shape 4, and an unresolvable
 *      spread might easily be hiding an unwrapped `name:`.
 *
 * A `name:`/positional value that is none of "wrapped in `attemptName(`" or
 * "an identifier whose own declaration is" is reported. So is a spread whose
 * source either hides an unwrapped name or can't be resolved at all.
 */

const DOCS_DIR = join(process.cwd(), 'e2e', 'docs');

interface Finding {
    /** What was found, for the failure message. */
    description: string;
}

/** Strips `//` and `/* … *\/` comments, the same shape `terminologyGuard.test.ts` uses,
 * so a comment mentioning `name:` in prose can't be mistaken for a real one. */
function stripComments(src: string): string {
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
    src = src.replace(/(^|\s)\/\/.*$/gm, (m) => ' '.repeat(m.length));
    return src;
}

/** The `{`/`}`/`['/']` depth at `index`, counting from the start of `text`. */
function depthAt(text: string, index: number): { curly: number; square: number } {
    let curly = 0;
    let square = 0;
    for (let i = 0; i < index; i++) {
        const c = text[i];
        if (c === '{') curly++;
        else if (c === '}') curly--;
        else if (c === '[') square++;
        else if (c === ']') square--;
    }
    return { curly, square };
}

/** The substring starting at `openIndex` (a `{`) through its matching `}`. */
function matchingBrace(text: string, openIndex: number): string | null {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(openIndex, i + 1);
        }
    }
    return null;
}

interface ObjectCheck {
    /** A literal `name:` key, or a `...ident` spread that might hide one. */
    kind: 'literal' | 'spread';
    /** For `literal`: the raw text right after the colon. For `spread`: the identifier. */
    text: string;
}

/**
 * Every `name: …` key and every `...ident` spread sitting directly inside
 * `obj` (curly depth 1 relative to `obj`'s own opening brace, square depth 0
 * — i.e. not inside a nested array).
 */
function topLevelChecks(obj: string): ObjectCheck[] {
    const checks: ObjectCheck[] = [];
    for (const m of obj.matchAll(/\bname\s*:\s*/g)) {
        const { curly, square } = depthAt(obj, m.index!);
        if (curly === 1 && square === 0) {
            checks.push({ kind: 'literal', text: obj.slice(m.index! + m[0].length) });
        }
    }
    for (const m of obj.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
        const { curly, square } = depthAt(obj, m.index!);
        if (curly === 1 && square === 0) {
            checks.push({ kind: 'spread', text: m[1] });
        }
    }
    return checks;
}

/** The token — a quoted literal or a bare identifier — starting at the front of `s`. */
function leadingToken(s: string): string {
    const quoted = /^(['"`])(?:(?!\1)[\s\S])*\1/.exec(s);
    if (quoted) return quoted[0];
    const ident = /^[A-Za-z_$][\w$]*/.exec(s);
    return ident ? ident[0] : s.slice(0, 20);
}

/**
 * Whether `value` (the text right after `name:`, or `ownTrack`'s positional
 * argument) is provably wrapped in `attemptName(` — directly, or one level of
 * indirection through a `const`/`let` declaration elsewhere in `stripped`.
 */
function isAttemptNamed(value: string, stripped: string): boolean {
    const token = leadingToken(value);
    if (/^attemptName\s*\(/.test(value)) return true;
    if (/^['"`]/.test(token)) return false; // a raw literal, unwrapped
    // An identifier: resolve its own declaration.
    const decl = new RegExp(`\\b(?:const|let)\\s+${token}\\s*=\\s*`).exec(stripped);
    if (!decl) return false; // can't verify — treat as unwrapped
    const rhs = stripped.slice(decl.index! + decl[0].length);
    return /^attemptName\s*\(/.test(rhs);
}

/**
 * Resolves a top-level `...ident` spread (shape 5) one level, the same reach
 * as `isAttemptNamed`'s own identifier indirection: find `ident`'s own
 * `const`/`let` declaration, and if it is an object literal with its own
 * top-level `name:`, report whether *that* is wrapped. `status` is:
 *
 * - `'ok'` — resolved, and either carries no `name:` of its own (nothing to
 *   check — the spread is for other fields, e.g. `trackId`) or carries one
 *   that is wrapped.
 * - `'unwrapped'` — resolved to an object whose own `name:` is a raw literal
 *   or an unwrapped identifier.
 * - `'unresolvable'` — no declaration found, the declaration isn't a plain
 *   object literal, or the object's own `name:` is itself hidden behind
 *   *another* spread (two levels deep, past what this guard reaches).
 */
function resolveSpreadName(
    ident: string,
    stripped: string,
): { status: 'ok' | 'unwrapped' | 'unresolvable'; token?: string } {
    const decl = new RegExp(`\\b(?:const|let)\\s+${ident}\\s*=\\s*`).exec(stripped);
    if (!decl) return { status: 'unresolvable' };
    const rhs = stripped.slice(decl.index! + decl[0].length).replace(/^\s+/, '');
    if (!rhs.startsWith('{')) return { status: 'unresolvable' };
    const objText = matchingBrace(rhs, 0);
    if (!objText) return { status: 'unresolvable' };

    const nested = topLevelChecks(objText);
    const nameCheck = nested.find((c) => c.kind === 'literal');
    if (!nameCheck) {
        // No name: of its own — but if what it has *instead* is another
        // spread, the real name (if any) is two levels away and unverifiable.
        return nested.some((c) => c.kind === 'spread') ? { status: 'unresolvable' } : { status: 'ok' };
    }
    if (isAttemptNamed(nameCheck.text, stripped)) return { status: 'ok' };
    return { status: 'unwrapped', token: leadingToken(nameCheck.text) };
}

function findingsIn(src: string): Finding[] {
    const stripped = stripComments(src);
    const findings: Finding[] = [];

    // Shape 1, 2 & 5: `race: {…}` / `track: {…}` / `seedRace(page, {…}`,
    // including a top-level `...ident` spread inside any of them.
    for (const m of stripped.matchAll(/\b(?:race|track)\s*:\s*\{|\bseedRace\(\s*page\s*,\s*\{/g)) {
        const openIndex = m.index! + m[0].length - 1; // the '{' itself
        const obj = matchingBrace(stripped, openIndex);
        if (!obj) continue;
        for (const check of topLevelChecks(obj)) {
            if (check.kind === 'literal') {
                if (!isAttemptNamed(check.text, stripped)) {
                    findings.push({
                        description: `${m[0].trim()} … name: ${leadingToken(check.text)}`,
                    });
                }
                continue;
            }
            const resolved = resolveSpreadName(check.text, stripped);
            if (resolved.status === 'unwrapped') {
                findings.push({
                    description:
                        `${m[0].trim()} … ...${check.text} (name: ${resolved.token}) — ` +
                        'spread hides the name — pass the name through attemptName() explicitly',
                });
            } else if (resolved.status === 'unresolvable') {
                findings.push({
                    description:
                        `${m[0].trim()} … ...${check.text} — ` +
                        'spread hides the name — pass the name through attemptName() explicitly',
                });
            }
        }
    }

    // Shape 3: `ownTrack(page, <name>, …)`.
    for (const m of stripped.matchAll(/\bownTrack\(\s*page\s*,\s*/g)) {
        const rest = stripped.slice(m.index! + m[0].length);
        const value = leadingToken(rest);
        if (!isAttemptNamed(rest, stripped)) {
            findings.push({ description: `ownTrack(page, ${value}, …)` });
        }
    }

    return findings;
}

function specFiles(): string[] {
    return readdirSync(DOCS_DIR)
        .filter((name) => name.endsWith('.spec.ts'))
        .sort();
}

describe('every unique name a docs spec creates is per-attempt (#1219)', () => {
    const files = specFiles();
    expect(files.length).toBeGreaterThan(10); // sanity: the directory was found

    for (const file of files) {
        it(`${file} wraps every race/track name in attemptName(...)`, () => {
            const src = readFileSync(join(DOCS_DIR, file), 'utf8');
            const findings = findingsIn(src);
            expect(
                findings.map((f) => f.description),
                `${file} creates a race or track name not wrapped in attemptName(...): ` +
                    findings.map((f) => f.description).join(' | '),
            ).toEqual([]);
        });
    }
});

/**
 * The scanner's own precision, pinned the same way `terminologyGuard.test.ts`
 * pins `findingsIn`'s shapes — including the mutation this guard exists to
 * catch: unwrap a race name (`'X'` in place of `attemptName('X')`) and it must
 * fail.
 */
describe('findingsIn', () => {
    it('flags a raw literal race name', () => {
        expect(findingsIn(`const race = { race: { name: 'Pack 42 Night', trackId } };`)).toEqual([
            { description: "race: { … name: 'Pack 42 Night'" },
        ]);
    });

    it('passes the identical race name wrapped in attemptName(...)', () => {
        expect(
            findingsIn(`const race = { race: { name: attemptName('Pack 42 Night'), trackId } };`),
        ).toEqual([]);
    });

    it('flags a raw literal track name', () => {
        expect(findingsIn(`await gql(page, m, { track: { name: 'Gym Track' } });`)).toEqual([
            { description: "track: { … name: 'Gym Track'" },
        ]);
    });

    it('flags a raw literal seedRace name', () => {
        expect(findingsIn(`const id = await seedRace(page, { name: 'Silent Track', trackId });`)).toEqual([
            { description: "seedRace(page, { … name: 'Silent Track'" },
        ]);
    });

    it('passes a seedRace name wrapped in attemptName(...)', () => {
        expect(
            findingsIn(`const id = await seedRace(page, { name: attemptName('Silent Track'), trackId });`),
        ).toEqual([]);
    });

    it('flags a raw literal ownTrack positional name', () => {
        expect(findingsIn(`const id = await ownTrack(page, 'Gym Track', 3);`)).toEqual([
            { description: "ownTrack(page, 'Gym Track', …)" },
        ]);
    });

    it('passes an ownTrack call whose name came from attemptName(...)', () => {
        const src = `
            const trackName = attemptName('Gym Track');
            const id = await ownTrack(page, trackName, 3);
        `;
        expect(findingsIn(src)).toEqual([]);
    });

    it('resolves one level of indirection through a const declaration', () => {
        const src = `
            const trackName = attemptName('Timer Demo Track');
            await gql(page, m, { track: { name: trackName, laneCount: 2 } });
        `;
        expect(findingsIn(src)).toEqual([]);
    });

    it('still flags indirection through an unwrapped const declaration', () => {
        const src = `
            const trackName = 'Timer Demo Track';
            await gql(page, m, { track: { name: trackName, laneCount: 2 } });
        `;
        expect(findingsIn(src)).toEqual([{ description: 'track: { … name: trackName' }]);
    });

    it('does not flag a racing group nested in a race object (RacingGroup.name is not unique)', () => {
        const src = `
            const race = await gql(page, m, {
                race: {
                    name: attemptName('2025 Pinewood Derby'),
                    racingGroups: [
                        { name: 'Lion', color: '#F4D03F' },
                        { name: 'Tiger', color: '#E67E22' },
                    ],
                },
            });
        `;
        expect(findingsIn(src)).toEqual([]);
    });

    it('does not flag a racer or award name (not race:/track:/seedRace/ownTrack shapes)', () => {
        const src = `
            const RACERS = [{ first: 'Ada', last: 'Lovelace', car: 3, name: 'Blue Streak' }];
            await gql(page, m, { id: raceId, award: { name: 'Fastest Car', kind: 'SPEED' } });
        `;
        expect(findingsIn(src)).toEqual([]);
    });

    it('does not flag an unrelated getByRole name locator', () => {
        expect(
            findingsIn(`await expect(page.getByRole('heading', { name: 'Welcome to Trusty Track' })).toBeVisible();`),
        ).toEqual([]);
    });

    it('ignores a name: mentioned only in a comment', () => {
        expect(
            findingsIn(`
                // race: { name: 'Not actually here' }
                const race = { race: { name: attemptName('Real Name') } };
            `),
        ).toEqual([]);
    });

    it('passes a name reached through a spread whose source is wrapped', () => {
        const src = `
            const overrides = { name: attemptName('Silent Track'), trackId };
            const id = await seedRace(page, { ...overrides, dateTime: '2026-01-01' });
        `;
        expect(findingsIn(src)).toEqual([]);
    });

    it('flags a name reached through a spread whose source is unwrapped', () => {
        const src = `
            const overrides = { name: 'Silent Track', trackId };
            const id = await seedRace(page, { ...overrides, dateTime: '2026-01-01' });
        `;
        expect(findingsIn(src).length).toBeGreaterThan(0);
    });

    it('flags an unresolvable spread rather than passing it silently', () => {
        const src = `
            const id = await seedRace(page, { ...RACE_DEFAULTS, dateTime: '2026-01-01' });
        `;
        expect(findingsIn(src).length).toBeGreaterThan(0);
    });
});
