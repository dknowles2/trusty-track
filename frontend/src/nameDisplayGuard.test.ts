import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which surfaces read the name-display formatter, and which must not
 * (#552). The split is the feature: a stranger reading a projector, a pit
 * pass, or a printed results sheet must not see more of a child's name than
 * the operator chose to show; the operator running the desk always needs
 * the whole name to find the right child in a queue.
 *
 * `features/core/displayName.ts` is the one module that turns a resolved
 * setting into a shortened string (`formatDisplayName`) or decides whether
 * a photo may show (`shouldShowRacerPhoto`). This guard is the enforcement
 * half, in the spirit of `terminologyGuard.test.ts`'s AST walk: rather than
 * scanning the whole tree for a pattern, it pins two explicit, reasoned
 * lists — every surface known to abbreviate must still import at least one
 * of the two functions, and every operator surface named here must import
 * neither. Getting either list wrong in either direction is exactly the
 * failure this feature is built to avoid.
 *
 * A file that merely imports `NAME_DISPLAY_OPTIONS` or the `NameDisplay`
 * type (the settings pages that render the picker itself: `SystemSettings.tsx`,
 * `RaceForm.tsx`) is neither an abbreviating surface nor an operator surface
 * under this guard — it is configuring the setting, not rendering a name
 * under it, so it is deliberately not enumerated in either list below.
 */

const SRC = join(process.cwd(), 'src');

function contents(relativePath: string): string {
    return readFileSync(join(SRC, relativePath), 'utf8');
}

/** Whether a file's source imports `formatDisplayName` or
 * `shouldShowRacerPhoto` from `displayName.ts` — the two functions that
 * actually shorten a name or hide a photo, as opposed to merely importing
 * the `NameDisplay` type or the settings-picker vocabulary. */
function readsTheFormatter(source: string): boolean {
    return /\b(formatDisplayName|shouldShowRacerPhoto)\b/.test(source);
}

/**
 * Every surface #552 names as abbreviating, paired with a one-line reason
 * it belongs on this list rather than being folded into a neighbour.
 */
const ABBREVIATING_SURFACES: Record<string, string> = {
    'features/observation/pages/Observation.tsx':
        'The audience display — heat cards, the standings tab, the projector cards and top-5 standings, the results overlay photo gate.',
    'features/observation/slideshow.ts':
        'The photo slideshow caption and its racer-photo gate; a racer whose only photo is their own drops out once it is hidden.',
    'features/awards/ceremony.ts':
        "The award ceremony's winner name and photo gate — the audience-facing use of `racerLabel`.",
    'features/awards/awardText.ts':
        '`racerLabel` is shared with the operator picker and management list (both default to FULL); the ceremony is the one caller that passes a resolved setting through.',
    'features/printables/components/PitPass.tsx':
        "Named explicitly in the issue's printables list.",
    'features/printables/components/DriversLicense.tsx':
        "Named explicitly in the issue's printables list.",
    'features/printables/components/CarSticker.tsx':
        'The impound label (#617) — affixed to a car or box, read by whoever is in the pits, not the operator desk.',
    'features/printables/heatSheet.ts':
        'The heat sheet.',
    'features/printables/resultsSheet.ts':
        'The results sheet, including its award lines.',
    'features/printables/certificate.ts':
        'The certificates.',
    'features/stats/standingsExport.ts':
        "The standings CSV export — named explicitly as the issue's one export.",
};

/**
 * Every surface #552 names as staying full, or that plays the same role —
 * a person at a desk matching a name to a child, not a stranger reading a
 * screen or a printout.
 */
const OPERATOR_SURFACES: Record<string, string> = {
    'features/management/components/RacerAvatar.tsx':
        "The roster's own avatar — the operator's working list.",
    'features/management/pages/RaceDetails.tsx':
        'The roster page itself.',
    'features/printables/components/CheckInCode.tsx':
        'Scanned by the check-in desk to find the right child, the same job as check-in itself — not a keepsake a scout carries around the venue.',
    'features/printables/components/CheckInScanner.tsx':
        'The check-in desk.',
    'features/racing/pages/RaceControl.tsx':
        'Race Control.',
    'features/racing/components/RaceExecution.tsx':
        'Race Execution — the operator running the heat.',
    'features/settings/pages/ActivityLog.tsx':
        'The activity log.',
    'features/stats/components/Leaderboard.tsx':
        "The Standings page's own on-screen table — distinct from Observation.tsx's audience-facing standings tab. Its CSV export abbreviates via `standingsExport.ts`, which this file calls but does not itself import the formatter from.",
};

describe('surfaces that abbreviate a racer name under the resolved setting (#552)', () => {
    for (const [path, reason] of Object.entries(ABBREVIATING_SURFACES)) {
        it(`${path} reads the formatter (${reason})`, () => {
            expect(readsTheFormatter(contents(path))).toBe(true);
        });
    }
});

describe('operator surfaces that always show the full name (#552)', () => {
    for (const [path, reason] of Object.entries(OPERATOR_SURFACES)) {
        it(`${path} does not read the formatter (${reason})`, () => {
            expect(readsTheFormatter(contents(path))).toBe(false);
        });
    }
});
