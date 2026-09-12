/**
 * Compares two directories of doc screenshots pixel-by-pixel and reports,
 * per image, how much changed — used two ways:
 *
 *   - By a developer or `regenerate-doc-screenshots.yml`, to measure the
 *     antialiasing residual between two runs on an otherwise-unchanged tree
 *     (dknowles2/trusty-track#838's own "measure before you design" step).
 *   - By CI's "Doc Screenshots" job, as the actual drift gate: comparing what
 *     the specs just rendered against what is committed under
 *     `docs/assets/screenshots/`, so a UI change that invalidates a published
 *     image is no longer silent.
 *
 * pixelmatch does the comparison, with `includeAA: false` (its default) — it
 * detects antialiased edge pixels and does not count them as a mismatch on
 * their own, which is exactly the noise #821/#827 left behind: the same font
 * file hinting or antialiasing a glyph a shade differently between two runs.
 * A pixel pixelmatch does count is a *content* difference — a focus ring, a
 * reflowed column, a collapsed panel — not rasterisation. That is what makes
 * a measured, fairly tight threshold survivable: see the distribution
 * recorded in `.claude/rules/documentation.md`.
 *
 * Usage:
 *   node compare-screenshots.ts <baselineDir> <candidateDir> \
 *     [--policy drift-policy.json] \
 *     [--json out.json] \
 *     [--exclude path,path] \
 *     [--max-diff-pixels N] [--max-diff-ratio R] \
 *     [--diff-dir dir]
 *
 * With no `--max-diff-*` flag this only measures and always exits 0 — that is
 * the mode the regeneration workflow's determinism check and a local
 * measurement run want. Passing a threshold turns it into a gate: exit code 1
 * if any image (missing, added, resized, or over the threshold) differs.
 * `--diff-dir` writes a visual diff PNG (pixelmatch's own highlighted output)
 * for every image that fails, for the CI job to upload as an artifact.
 *
 * `--policy` reads `maxDiffPixels`, `maxDiffRatio` and `exclude` from a JSON
 * file (`drift-policy.json` beside this script is the one CI uses), so that
 * the PR-time check and the post-merge regeneration cannot disagree about
 * what counts as drift — the regeneration stages exactly the images this
 * policy flags and nothing else. An explicit flag still overrides the file.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

interface ImageDiff {
    path: string;
    baselineMissing?: boolean;
    candidateMissing?: boolean;
    sizeMismatch?: boolean;
    baselineWidth?: number;
    baselineHeight?: number;
    candidateWidth?: number;
    candidateHeight?: number;
    diffPixels?: number;
    totalPixels?: number;
    diffRatio?: number;
}

function walkPngs(dir: string, base = dir): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            out.push(...walkPngs(full, base));
        } else if (entry.endsWith('.png')) {
            out.push(relative(base, full).split(sep).join('/'));
        }
    }
    return out;
}

function compareOne(
    baselineDir: string,
    candidateDir: string,
    relPath: string,
    diffDir?: string,
): ImageDiff {
    const baselinePath = join(baselineDir, relPath);
    const candidatePath = join(candidateDir, relPath);

    if (!existsSync(baselinePath)) {
        return { path: relPath, baselineMissing: true };
    }
    if (!existsSync(candidatePath)) {
        return { path: relPath, candidateMissing: true };
    }

    const baseline = PNG.sync.read(readFileSync(baselinePath));
    const candidate = PNG.sync.read(readFileSync(candidatePath));

    if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
        return {
            path: relPath,
            sizeMismatch: true,
            baselineWidth: baseline.width,
            baselineHeight: baseline.height,
            candidateWidth: candidate.width,
            candidateHeight: candidate.height,
        };
    }

    const { width, height } = baseline;
    const diffImage = diffDir ? new PNG({ width, height }) : undefined;
    const diffPixels = pixelmatch(
        baseline.data,
        candidate.data,
        diffImage?.data,
        width,
        height,
        { threshold: 0.1, includeAA: false },
    );
    const totalPixels = width * height;

    if (diffDir && diffImage && diffPixels > 0) {
        const outPath = join(diffDir, relPath);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, PNG.sync.write(diffImage));
    }

    return {
        path: relPath,
        diffPixels,
        totalPixels,
        diffRatio: diffPixels / totalPixels,
    };
}

export function compareDirectories(
    baselineDir: string,
    candidateDir: string,
    exclude: string[] = [],
    diffDir?: string,
): ImageDiff[] {
    const baselinePngs = existsSync(baselineDir) ? walkPngs(baselineDir) : [];
    const candidatePngs = existsSync(candidateDir) ? walkPngs(candidateDir) : [];
    const allPaths = Array.from(new Set([...baselinePngs, ...candidatePngs])).sort();
    return allPaths
        .filter((p) => !exclude.includes(p))
        .map((relPath) => compareOne(baselineDir, candidateDir, relPath, diffDir));
}

function isViolation(r: ImageDiff, maxDiffPixels?: number, maxDiffRatio?: number): boolean {
    if (r.baselineMissing || r.candidateMissing || r.sizeMismatch) {
        return true;
    }
    const pixels = r.diffPixels ?? 0;
    if (pixels === 0) {
        return false;
    }
    if (maxDiffPixels === undefined && maxDiffRatio === undefined) {
        // Measurement-only mode: nothing is a "violation".
        return false;
    }
    const pixelsOk = maxDiffPixels === undefined || pixels <= maxDiffPixels;
    const ratioOk = maxDiffRatio === undefined || (r.diffRatio ?? 0) <= maxDiffRatio;
    return !(pixelsOk && ratioOk);
}

interface DriftPolicy {
    maxDiffPixels?: number;
    maxDiffRatio?: number;
    exclude?: string[];
}

function parseArgs(argv: string[]) {
    const positional: string[] = [];
    let jsonOut: string | undefined;
    let exclude: string[] | undefined;
    let maxDiffPixels: number | undefined;
    let maxDiffRatio: number | undefined;
    let diffDir: string | undefined;
    let policy: DriftPolicy = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') {
            jsonOut = argv[++i];
        } else if (arg === '--exclude') {
            exclude = (argv[++i] ?? '').split(',').filter(Boolean);
        } else if (arg === '--max-diff-pixels') {
            maxDiffPixels = Number(argv[++i]);
        } else if (arg === '--max-diff-ratio') {
            maxDiffRatio = Number(argv[++i]);
        } else if (arg === '--diff-dir') {
            diffDir = argv[++i];
        } else if (arg === '--policy') {
            policy = JSON.parse(readFileSync(argv[++i], 'utf8')) as DriftPolicy;
        } else {
            positional.push(arg);
        }
    }
    // An explicit flag wins over the policy file; the file fills in the rest.
    return {
        positional,
        jsonOut,
        exclude: exclude ?? policy.exclude ?? [],
        maxDiffPixels: maxDiffPixels ?? policy.maxDiffPixels,
        maxDiffRatio: maxDiffRatio ?? policy.maxDiffRatio,
        diffDir,
    };
}

function main() {
    const { positional, jsonOut, exclude, maxDiffPixels, maxDiffRatio, diffDir } = parseArgs(
        process.argv.slice(2),
    );
    const [baselineDir, candidateDir] = positional;
    if (!baselineDir || !candidateDir) {
        console.error(
            'Usage: node compare-screenshots.ts <baselineDir> <candidateDir> ' +
                '[--policy drift-policy.json] [--json out.json] [--exclude a.png,b.png] ' +
                '[--max-diff-pixels N] [--max-diff-ratio R] [--diff-dir dir]',
        );
        process.exit(2);
    }

    const gating = maxDiffPixels !== undefined || maxDiffRatio !== undefined;
    const results = compareDirectories(baselineDir, candidateDir, exclude, diffDir);

    let violations = 0;
    let benign = 0;
    for (const r of results) {
        const violated = isViolation(r, maxDiffPixels, maxDiffRatio);
        if (r.baselineMissing) {
            console.log(`${violated ? 'FAIL' : 'INFO'}  NEW       ${r.path}`);
        } else if (r.candidateMissing) {
            console.log(`${violated ? 'FAIL' : 'INFO'}  REMOVED   ${r.path}`);
        } else if (r.sizeMismatch) {
            console.log(
                `${violated ? 'FAIL' : 'INFO'}  RESIZED   ${r.path}  (${r.baselineWidth}x${r.baselineHeight} -> ${r.candidateWidth}x${r.candidateHeight})`,
            );
        } else if ((r.diffPixels ?? 0) > 0) {
            const label = violated ? 'FAIL' : 'diff';
            console.log(
                `${label}  DIFF      ${r.path}  ${r.diffPixels} px (${((r.diffRatio ?? 0) * 100).toFixed(4)}%)`,
            );
            if (!violated) benign++;
        }
        if (violated) violations++;
    }

    console.log(
        `\n${results.length} image(s) compared, ${violations} exceeding the threshold` +
            (gating ? '' : ' (measurement only — no threshold set)') +
            (benign > 0 ? `, ${benign} within it` : '') +
            '.',
    );

    if (jsonOut) {
        writeFileSync(jsonOut, JSON.stringify(results, null, 2));
    }

    if (gating && violations > 0) {
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
