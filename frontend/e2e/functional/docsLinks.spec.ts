/**
 * Every major screen links to the docs page that explains it (#1194).
 *
 * Unit tests (`docsLinkGuard.test.ts`, `DocsLink.test.tsx`, `FieldHelp.test.tsx`)
 * already pin that the right component renders with the right `docsKey`.
 * What they cannot see is two correct changes colliding on the *same* live
 * page — a header that renders a `DocsLink` desktop-side and a second one
 * inside a phone overflow that both end up mounted at once, say — which is
 * exactly the class of bug this suite exists to catch (`ci.md`'s "agent
 * briefs must require e2e"). So this drives the real served page and counts
 * the actual DOM, on both a desktop and a phone viewport.
 */

import { expect, test } from '@playwright/test';

import { createSchedule, ensureConfigured, readHeats, recordRound, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * Screens whose page a `DocsLink` should be reachable on right after an SPA
 * navigation, with no extra clicking — the desktop shape from #1194's own
 * placement list. Awards' phone-overflow reachability is its own test below,
 * since that one *does* need a click first.
 *
 * `needsResults`: Standings' own header — the row the `DocsLink` sits in —
 * is part of `Leaderboard.tsx`'s ordinary render, not its "No results yet"
 * empty state, which replaces the whole card with a single centered
 * paragraph and nothing else. A schedule with nothing recorded is exactly
 * that empty state, so this seeds a recorded heat first, the same fixture
 * shape `mobileStandingsAndAwards.spec.ts` already uses to reach the same
 * page's real layout.
 *
 * `expectedLinks`: every screen but one carries exactly one door in, the
 * point #1194 exists to make. Displays is the deliberate exception (#1300):
 * its own `<h1>` links to the displays guide, same as ever, and the
 * "Connect a camera" card (and its no-track notice sibling) now carries a
 * *second*, genuinely different door — the Instant Replay guide — at the
 * one moment an operator is actually reaching for it. Two links to two
 * different guides on one page is not the duplicate this suite exists to
 * catch; two links to the *same* guide would be, which is exactly why the
 * screen card next to it was deliberately left with none of its own (see
 * `DisplaysPanel.tsx`'s own comment on that choice).
 */
const SCREENS: {
    name: string;
    path: (raceId: number) => string;
    needsResults?: boolean;
    expectedLinks?: number;
}[] = [
    { name: 'Roster', path: (raceId) => `/race/${raceId}` },
    { name: 'Control', path: (raceId) => `/race/${raceId}/control` },
    { name: 'Standings', path: (raceId) => `/race/${raceId}/standings`, needsResults: true },
    { name: 'Awards', path: (raceId) => `/race/${raceId}/awards` },
    { name: 'Stats', path: (raceId) => `/race/${raceId}/stats` },
    { name: 'Displays', path: (raceId) => `/race/${raceId}/displays`, expectedLinks: 2 },
];

test.describe('desktop viewport', () => {
    for (const screen of SCREENS) {
        const expectedLinks = screen.expectedLinks ?? 1;
        const linkWord = expectedLinks === 1 ? 'exactly one docs link' : `exactly ${expectedLinks} docs links`;
        test(`${screen.name} shows ${linkWord}, opening trusty-track.com in a new tab`, async ({ page }) => {
            const { raceId, racers } = await seedRace(page, `Docs Links ${screen.name} ${Date.now()}`);
            await createSchedule(page, raceId);
            await ensureConfigured(page);

            if (screen.needsResults) {
                const heats = await readHeats(page, raceId);
                await recordRound(page, heats, racers);
            }

            await page.goto(screen.path(raceId));

            // The wait *is* the assertion: retried until the link the test
            // is about actually exists, rather than a `networkidle` guess
            // about when an SPA navigation has "settled" (`ci.md`'s own
            // rule against that pattern).
            const links = page.getByTestId('docs-link');
            await expect(links).toHaveCount(expectedLinks);

            for (let i = 0; i < expectedLinks; i++) {
                const link = links.nth(i);
                await expect(link).toHaveAttribute('href', /^https:\/\/trusty-track\.com\/docs\//);
                await expect(link).toHaveAttribute('target', '_blank');
                await expect(link).toHaveAttribute('rel', /noopener/);
            }
        });
    }
});

test.describe('phone viewport (390px)', () => {
    test("Awards' docs link is reachable inside the awards-more-menu overflow", async ({ page }) => {
        const { raceId } = await seedRace(page, `Docs Links Awards Phone ${Date.now()}`);
        await ensureConfigured(page);

        await page.setViewportSize(PHONE_VIEWPORT);
        await page.goto(`/race/${raceId}/awards`);

        // Nothing carrying a docs link is mounted until the overflow opens —
        // `Awards.tsx`'s `awardsMenuOpen` gate, same shape
        // `mobileStandingsAndAwards.spec.ts` already exercises for this menu.
        await expect(page.getByTestId('awards-more-menu')).toBeVisible();
        await expect(page.getByTestId('docs-link')).toHaveCount(0);

        await page.getByTestId('awards-more-menu').click();

        const links = page.getByTestId('docs-link');
        await expect(links).toHaveCount(1);
        await expect(links.first()).toHaveAttribute('href', /^https:\/\/trusty-track\.com\/docs\//);
        await expect(links.first()).toBeVisible();
    });
});
