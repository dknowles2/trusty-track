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
