/**
 * Display scenes: configuring every audience screen at once (#613).
 *
 * A scene is a saved (or built-in) recipe for what every screen should show,
 * applied with one click instead of reassigning each row on the Displays
 * panel by hand. See `.claude/rules/displays.md`'s "Scenes" section for the
 * full design reasoning — in short, an entry carries a *whole* assignment
 * (view plus every rider), a saved scene is stored server-side while a
 * built-in preset is pure code applied live, and applying is best-effort:
 * a screen that has gone quiet is skipped and reported, never a reason to
 * refuse the rest.
 *
 * This module holds the one pure rule worth pulling out of the component —
 * summarizing an `ApplySceneResult` into the sentence the toast shows — the
 * same `raceFlow.ts`/`useRaceFlow.ts` split every other feature here uses.
 */

export interface ApplySceneOutcome {
    displayId: string;
    displayName: string;
    applied: boolean;
}

export interface ApplySceneSummary {
    appliedCount: number;
    skippedCount: number;
    outcomes: readonly ApplySceneOutcome[];
}

/**
 * What to tell the operator after applying a scene or a preset.
 *
 * Names the skipped screens by their captured name — "Lobby" — rather than
 * a bare id, so a screen that has gone quiet since the scene was saved is
 * still recognisable in the sentence, not just a count.
 */
export function summarizeApplyResult(result: ApplySceneSummary): string {
    const total = result.appliedCount + result.skippedCount;
    if (total === 0) {
        return 'No displays to apply this to yet.';
    }
    if (result.skippedCount === 0) {
        return total === 1 ? 'Applied to the one connected screen.' : `Applied to all ${total} screens.`;
    }
    const skippedNames = result.outcomes
        .filter((o) => !o.applied)
        .map((o) => o.displayName)
        .join(', ');
    return `Applied to ${result.appliedCount} of ${total} screens. Not connected: ${skippedNames}.`;
}
