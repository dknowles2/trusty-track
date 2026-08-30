/**
 * How much of a racer's name a screen prints (#552).
 *
 * `Race.resolvedNameDisplay` and `InitialConfigStatus.resolvedNameDisplay`
 * are already resolved server-side — organization default layered under a
 * race override, layered under `FULL` (`backend/domain/name_display.py`,
 * the same shape as `resolve_terminology`). This module is the one place
 * that turns that resolved setting plus a racer's stored first/last name
 * into the string a screen prints.
 *
 * A new module rather than growing `utils/avatarUtils.ts`: that file derives
 * a two-letter monogram for a placeholder avatar, a different question from
 * what a screen writes out as somebody's name, and mixing the two would
 * make a change to one silently risk the other. It lives under
 * `features/core/` — the same home as `pageTitle.ts` and
 * `activeNavLink.ts` — because, unlike a feature's own vocabulary
 * (`features/awards/awardText.ts`, say), this is read across several
 * unrelated features (observation, printables, awards, stats) with no
 * single natural owner among them.
 *
 * **The split is the feature, not the formatter.** Every *abbreviating*
 * surface — the audience displays, the printables, the standings export —
 * calls `formatDisplayName` rather than reading `first_name`/`last_name`
 * for itself, the same "one rule, one place" reasoning [#48](https://github.com/dknowles2/trusty-track/issues/48)
 * already established for a rule with several call sites. The *operator*
 * surfaces — the roster, check-in, Race Control/Race Execution, the
 * activity log — must **not** import this module at all: the check-in desk
 * needs a full name to find the right child in a queue, and the roster is
 * the operator's own working list, not something a stranger reads off a
 * gym wall. `nameDisplayGuard.test.ts` is the enforcement half, the same
 * AST-walk shape `terminologyGuard.test.ts` already uses for the
 * terminology words.
 */

/** Mirrors the GraphQL `resolvedNameDisplay` value — always one of these
 * three, never null, since the server has already resolved it. Typed as a
 * union for the call sites that switch on it directly; `formatDisplayName`
 * itself accepts a plain `string` too, since a value the frontend does not
 * recognise (an old build talking to a newer server, say) should render as
 * though it were `FULL` rather than crash. */
export type NameDisplay = 'FULL' | 'LAST_INITIAL' | 'FIRST_ONLY';

/**
 * Turn a resolved name-display setting and a racer's stored name into the
 * string a screen should print.
 *
 * Three edge cases, each a real shape a roster holds and each handled the
 * same way regardless of which value is set:
 *
 * - **A single-word name** (no last name on file) — `LAST_INITIAL` has
 *   nothing to initial, so it falls back to the first name alone rather
 *   than printing a bare `"Jordan ."`; `FIRST_ONLY` and `FULL` already
 *   print just the first name in this case.
 * - **An empty first name** (a roster row entered surname-first, or a
 *   partial import) — `FIRST_ONLY` falls back to the last name rather than
 *   an empty string, since printing nothing is worse than printing
 *   something identifying; `LAST_INITIAL` prints the bare initial.
 * - **A hyphenated or multi-part surname** ("Garcia-Lopez", "de la Cruz") —
 *   the initial is the surname's *first* letter, not its last word's: "de
 *   la Cruz" reads as "D.", matching how a person abbreviates their own
 *   name on a form. Taking the final word's initial ("C.") would silently
 *   drop the rest of the surname's identity from the abbreviation, which is
 *   the opposite of what an operator choosing this setting wants.
 */
export function formatDisplayName(
    nameDisplay: NameDisplay | string,
    firstName: string,
    lastName: string,
): string {
    const first = firstName.trim();
    const last = lastName.trim();

    switch (nameDisplay) {
        case 'FIRST_ONLY':
            return first || last;
        case 'LAST_INITIAL': {
            if (!last) return first;
            const initial = last.charAt(0).toUpperCase();
            return first ? `${first} ${initial}.` : `${initial}.`;
        }
        case 'FULL':
        default:
            return [first, last].filter(Boolean).join(' ');
    }
}

/**
 * Whether a racer's photograph may appear alongside their name under this
 * setting (#552's own "where it does not reach" carve-out).
 *
 * A picture of a child's face beside "Jordan M." is not anonymised, so the
 * same control that shortens the name also covers the *racer* photo on the
 * audience displays — hidden, or replaced with the initials placeholder
 * `RacerAvatar` already falls back to when no image is available. The
 * *car* photo is a different question (it identifies a vehicle, not a
 * child) and is untouched by this setting; callers simply never pass it
 * through this check.
 */
export function shouldShowRacerPhoto(nameDisplay: NameDisplay | string): boolean {
    return nameDisplay === 'FULL';
}

/**
 * The picker vocabulary, shared by System Settings (the organization
 * default) and the race edit form (the per-race override) — the one place
 * the three labels and descriptions live, so the two forms cannot describe
 * the same setting differently. Every description is meant to stay visible
 * beside its option (#304), not revealed only once picked.
 */
export interface NameDisplayOption {
    value: NameDisplay;
    label: string;
    description: string;
}

export const NAME_DISPLAY_OPTIONS: readonly NameDisplayOption[] = [
    {
        value: 'FULL',
        label: 'Full name',
        description: 'Jordan Mitchell. The default, and today’s behaviour.',
    },
    {
        value: 'LAST_INITIAL',
        label: 'First name and last initial',
        description: 'Jordan M. The common choice for a screen the public can see.',
    },
    {
        value: 'FIRST_ONLY',
        label: 'First name only',
        description: 'Jordan. For a pack whose own policy says no surname on a public screen.',
    },
];
