/**
 * Two award-form defaults that shipped disagreeing with each other (#992,
 * #999).
 *
 * #999: "Add an award" opened on **Somebody we choose**, so a name like
 * "Pack Champion" silently became a judged, votable award that could never
 * resolve. #992 was the edit-side twin: fixing the mistake by switching an
 * existing judged award to Speed-based saved it with `source: null,
 * place: null` — the selects displayed a default the draft never held, and
 * Save sent the nulls straight through. Both are covered end to end here
 * because the bug is in what actually gets *sent* over the GraphQL round
 * trip, which a mocked `useMutation` cannot see (`AwardForm.test.tsx` and
 * `Awards.test.tsx` pin the draft/render logic itself with a spy).
 */

import { expect, test } from '@playwright/test';
import { gql, seedRace } from './support';

test('a new award defaults to Speed-based and resolves with no further input (#999)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Award Default Kind Race');

    await page.goto(`/race/${raceId}/awards`);
    // A fresh race has no awards, so the toolbar's corner "Add an award"
    // and the empty state's own button of the same name are both on
    // screen (Awards.test.tsx pins there being two) — scope to the empty
    // state so this isn't a race against which one the empty-state query
    // has rendered yet (#1334).
    await page.getByTestId('awards-empty').getByRole('button', { name: 'Add an award' }).click();

    // No kind is chosen by hand — Speed-based is already selected, and the
    // standings-source select is already showing, not the judged half.
    await expect(page.getByLabel('Award name')).toBeVisible();
    await expect(page.getByLabel('Standings to use')).toBeVisible();
    await expect(page.getByLabel('Winner')).not.toBeVisible();

    await page.getByLabel('Award name').fill('Fastest Car');
    await page.getByRole('button', { name: 'Add award' }).click();

    await expect(page.getByText('Fastest Car')).toBeVisible();
    // The race has no checked-in racers, so nobody holds it yet — but the
    // rule itself is real, not "Not set up".
    await expect(page.getByText('Fastest overall')).toBeVisible();
    await expect(page.getByText(/not set up/i)).not.toBeVisible();
});

test('switching a judged award to Speed-based on the edit form actually resolves (#992)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Award Edit Kind Switch Race');

    // A judged award nobody has decided yet — the state "Pack Champion" is
    // in right after #999's own mistake.
    await gql(
        page,
        `mutation Award($raceId: Int!, $award: AwardInput!) {
            createAward(raceId: $raceId, award: $award) { id }
        }`,
        { raceId, award: { name: 'Pack Champion', kind: 'SPECIAL' } },
    );

    await page.goto(`/race/${raceId}/awards`);
    await expect(page.getByText('Pack Champion')).toBeVisible();
    await expect(page.getByText('Chosen by the judges')).toBeVisible();

    await page.getByLabel('Edit Pack Champion').click();
    await page.getByLabel(/speed-based/i).click();

    // What the form shows before saving is what will actually be sent — the
    // whole bug was a gap between the two.
    await expect(page.getByLabel('Standings to use')).toHaveValue('ALL');
    await expect(page.getByLabel('Position')).toHaveValue('1');

    await page.getByRole('button', { name: 'Save changes' }).click();

    // Reload to prove the round trip: the server was actually sent a real
    // rule, not what happened to be on screen a moment ago.
    await page.reload();
    await expect(page.getByText('Pack Champion')).toBeVisible();
    await expect(page.getByText('Fastest overall')).toBeVisible();
    await expect(page.getByText(/not set up/i)).not.toBeVisible();
});

test('the empty state\'s own "Add an award" opens the form even once both buttons of that name are on screen (#1334)', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Award Empty State Race');

    // #1334: on a race with no awards yet, the toolbar's corner "Add an
    // award" and the empty state's own button share that name
    // (Awards.test.tsx pins there being two). The bug this test pins was
    // a locator ambiguous between them the instant both had rendered — a
    // race the original spec happened to win when the awards query
    // answered fast, and lost when it didn't. Delaying that query here
    // makes the empty state's arrival — and so the ambiguity, absent the
    // fix — unconditional rather than hoped for.
    await page.route('**/graphql', async (route) => {
        let query: string | undefined;
        try {
            query = (route.request().postDataJSON() as { query?: string } | null)?.query;
        } catch {
            query = undefined;
        }
        if (query?.includes('RaceAwards')) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await route.continue();
    });

    await page.goto(`/race/${raceId}/awards`);
    await expect(page.getByTestId('awards-empty')).toBeVisible();
    // Both buttons really are on screen at once — this is what made the
    // bare locator ambiguous.
    await expect(page.getByRole('button', { name: 'Add an award' })).toHaveCount(2);

    await page.getByTestId('awards-empty').getByRole('button', { name: 'Add an award' }).click();
    await expect(page.getByLabel('Award name')).toBeVisible();
});
