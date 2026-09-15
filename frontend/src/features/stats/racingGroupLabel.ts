/**
 * Whether a racing group's Category is worth printing beside its name (#774).
 *
 * The setup wizard's Cub Scout scaffold names every rank preset's Category
 * after its own name — "Bear" the den, "Bear" the Category, for every rank —
 * so `Leaderboard.tsx`'s plain "name (division)" composition prints
 * "Bear (Bear)" on every row of a race set up through the wizard. A division
 * that only repeats the group's own name adds nothing a reader does not
 * already have from the name column, so it is not shown at all — not even
 * the parentheses.
 *
 * Pure, so both the check and its exceptions are one rule rather than a copy
 * inside the render.
 */
export function shouldShowDivision(name: string, division: string | null | undefined): boolean {
    if (!division) return false;
    const trimmedDivision = division.trim();
    if (!trimmedDivision) return false;
    return trimmedDivision.toLowerCase() !== name.trim().toLowerCase();
}

/**
 * The racing group's name, plus its Category in parentheses when
 * `shouldShowDivision` says it adds something — "Wolves (Wolf)" or plain
 * "Bear". One string, not the name-then-conditional-span `Leaderboard.tsx`
 * built inline, because `Leaderboard.tsx`'s mobile meta line (#1138)
 * composes this alongside a heat count into a *single* text node — a nested
 * span reproducing "(Wolf)" as its own element would give
 * `screen.getByText('(Wolf)')` two matches instead of one once both the
 * desktop Den column and the mobile meta line are on the page at once.
 */
export function racingGroupLabel(name: string, division: string | null | undefined): string {
    return shouldShowDivision(name, division) ? `${name} (${division})` : name;
}

/** "1 heat" / "3 heats" — English's irregular plural is a one-line rule,
 * not worth a dependency. */
export function heatsSummary(heatsCompleted: number): string {
    return `${heatsCompleted} heat${heatsCompleted === 1 ? '' : 's'}`;
}
