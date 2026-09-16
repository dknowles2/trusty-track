/**
 * A shareable address must not break the sentence around it mid-word
 * (#1151).
 *
 * `ConnectDisplayAddress.tsx` (Displays panel) and `BallotShare.tsx`
 * (Awards page) both used to put `wordBreak: 'break-all'` on the span
 * holding the whole sentence, not just the address, which broke ordinary
 * prose mid-word at phone width ("fro / m their phones"). The fix scopes
 * `overflow-wrap: anywhere` to the `<ShareableUrl>` holding just the
 * address (`frontend/src/components/ui/ShareableUrl.tsx`) — unit-tested
 * there for the CSS property itself; this is the one check no unit test
 * (jsdom has no layout) can do: that a real browser, at a real phone
 * width, never splits a *word* of the sentence across two lines.
 */

import { expect, Locator, test } from '@playwright/test';

import { ensureConfigured, gql, seedRace } from './support';

const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * True when no word of `locator`'s own sentence text is split across two
 * lines. Walks every text node under the element, skipping anything inside
 * a `<code>` — the address itself is expected (and allowed) to wrap
 * wherever it must; it is the *prose* around it that must never break
 * mid-word. For each word, a `Range` over just that substring reports one
 * `getClientRects()` row when the word rendered on a single line and more
 * than one when the browser broke it apart.
 */
async function sentenceWordsAreUnbroken(locator: Locator): Promise<boolean> {
    return locator.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                let ancestor = node.parentElement;
                while (ancestor && ancestor !== el) {
                    if (ancestor.tagName === 'CODE') return NodeFilter.FILTER_REJECT;
                    ancestor = ancestor.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent || '';
            const wordPattern = /\S+/g;
            let match: RegExpExecArray | null;
            while ((match = wordPattern.exec(text))) {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                const tops = new Set(
                    Array.from(range.getClientRects())
                        .filter((r) => r.width > 0 && r.height > 0)
                        .map((r) => Math.round(r.top)),
                );
                if (tops.size > 1) return false;
            }
        }
        return true;
    });
}

test.describe('shareable address does not break a word (#1151)', () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test('Displays panel: "connect this screen" sentence stays whole', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Shareable Address Displays ' + Date.now());
        await ensureConfigured(page);
        await page.goto(`/race/${raceId}/displays`);
        await page.waitForLoadState('networkidle');

        const sentence = page
            .locator('span', { hasText: 'Open this address on a screen' })
            .first();
        await expect(sentence).toBeVisible();
        expect(sentence.locator('code')).toBeTruthy();
        expect(await sentenceWordsAreUnbroken(sentence)).toBe(true);
    });

    test('Awards page: "share this address to vote" sentence stays whole', async ({ page }) => {
        const { raceId } = await seedRace(page, 'Shareable Address Awards ' + Date.now());
        await ensureConfigured(page);
        // The voting banner (and the BallotShare share step inside it) only
        // renders once the race has at least one award — an ordinary judged
        // award, since that is what makes voting itself meaningful.
        await gql(
            page,
            `mutation AddAwardForSpec($raceId: Int!, $award: AwardInput!) {
                createAward(raceId: $raceId, award: $award) { id }
            }`,
            { raceId, award: { name: 'Best Paint' } },
        );
        // Open voting directly, the same field the page's own toggle writes —
        // driving it through the disabled-until-votable button would need
        // more setup for no reason this spec cares about.
        await gql(
            page,
            `mutation OpenVotingForSpec($id: Int!) {
                updateRace(id: $id, race: { votingOpen: true }) { id votingOpen }
            }`,
            { id: raceId },
        );
        await page.goto(`/race/${raceId}/awards`);
        await page.waitForLoadState('networkidle');

        const sentence = page
            .locator('span', { hasText: 'Share this address for people to vote' })
            .first();
        await expect(sentence).toBeVisible();
        expect(await sentenceWordsAreUnbroken(sentence)).toBe(true);
    });
});
