/**
 * Which race-navigation link the current page belongs to.
 *
 * An exact comparison was the bug: Control's sub-sections
 * (`/race/1/control/schedule`, `/race/1/control/displays`…) are Control, but
 * `pathname === to` highlighted nothing there, so the row went quiet exactly
 * when the operator was deepest in it.
 *
 * A bare prefix test is the other trap — Roster's link is `/race/1`, a
 * prefix of every race page, so it would light up everywhere. The rule is
 * therefore *longest* matching link: on `/race/1/control/displays` both
 * Roster and Control match as prefixes, and Control wins. Pages under no
 * deeper link — `/race/1/print` — fall to Roster, which is where their
 * button lives.
 */

/** True when `pathname` is `to` itself or a sub-path of it. */
function covers(to: string, pathname: string): boolean {
    return pathname === to || pathname.startsWith(to + '/');
}

/** The `to` of the link the current page belongs to, or null off the row. */
export function activeNavLink(
    pathname: string,
    links: readonly { to: string }[],
): string | null {
    let winner: string | null = null;
    for (const link of links) {
        if (covers(link.to, pathname) && (winner === null || link.to.length > winner.length)) {
            winner = link.to;
        }
    }
    return winner;
}
