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
 *
 * That "where their button lives" premise does not hold for every print
 * sub-page — the print pages hang off `/race/:id/print`, a path segment with
 * no nav link of its own, but the buttons that reach them are scattered
 * across the row (#417). `PRINT_SUB_PAGE_OWNERS` names the ones the
 * longest-prefix rule would otherwise hand to Roster; it is checked first,
 * against the pathname's segment right after `print/`, before the general
 * rule runs. Sub-pages absent from it — the sheet itself, the heat sheet —
 * keep falling to Roster, which is where their buttons actually are.
 */

/** Print sub-pages whose button lives on a link other than Roster. */
const PRINT_SUB_PAGE_OWNERS: Record<string, string> = {
    certificates: 'awards',
    results: 'standings',
};

/** True when `pathname` is `to` itself or a sub-path of it. */
function covers(to: string, pathname: string): boolean {
    return pathname === to || pathname.startsWith(to + '/');
}

/** The owning link's `to`, for a `/race/:id/print/<page>` pathname, or null. */
function printSubPageOwner(pathname: string, links: readonly { to: string }[]): string | null {
    const match = pathname.match(/^(\/race\/[^/]+)\/print\/([^/]+)/);
    if (!match) return null;
    const owner = PRINT_SUB_PAGE_OWNERS[match[2]];
    if (!owner) return null;
    const ownerTo = `${match[1]}/${owner}`;
    return links.some((link) => link.to === ownerTo) ? ownerTo : null;
}

/** The `to` of the link the current page belongs to, or null off the row. */
export function activeNavLink(
    pathname: string,
    links: readonly { to: string }[],
): string | null {
    const printOwner = printSubPageOwner(pathname, links);
    if (printOwner !== null) return printOwner;

    let winner: string | null = null;
    for (const link of links) {
        if (covers(link.to, pathname) && (winner === null || link.to.length > winner.length)) {
            winner = link.to;
        }
    }
    return winner;
}
