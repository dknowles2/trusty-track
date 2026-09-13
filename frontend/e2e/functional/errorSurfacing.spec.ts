/**
 * A refused mutation shows the server's own sentence, not a fixed string
 * (#1092, #1095).
 *
 * `RaceDetailsPopulate.test.tsx`, `RacerFormPhotoUpload.test.tsx` and
 * `BulkPhotoUploadModal.test.tsx` already pin `errorText(e, fallback)`
 * against a mocked `useMutation` — what only a real backend and a real
 * browser add is that the alert an operator actually sees, end to end, is
 * built from the GraphQL response the network really carried, not from
 * whatever shape a mock happened to hand the component. There is no cheap
 * way to make the *real* backend refuse `populateRace` or `uploadImage`
 * without also standing up a second, demo-mode backend + frontend pair
 * (a `TRUSTYTRACK_DEMO_MODE=1` server on its own ports, a second Playwright
 * project to point at it) — real work for a harness whose specs all
 * currently share the one ordinary-install backend `configure.setup.ts`
 * configures (see `.claude/rules/ci.md`'s "What the functional e2e specs
 * are for"). So this intercepts the one GraphQL call under test and returns
 * exactly the shape the server would send *were* it refusing — a genuine
 * GraphQL error response, not a network failure — and lets everything else
 * (the page, the mutation, the normalized cache, the alert) run for real.
 * The demo's own refusals are covered where the demo itself is: backend
 * (`test_demo_mode.py`) and frontend component tests, listed above.
 */

import { test, expect } from '@playwright/test';
import { seedRace } from './support';

/** Fulfil one GraphQL operation with an error, and pass every other one
 * straight through untouched — the same shape `screenshot-bulk-upload.spec
 * .ts` already uses for a benign intercept of `uploadImage`. */
async function refuseMutation(
    page: import('@playwright/test').Page,
    mutationName: string,
    message: string,
): Promise<void> {
    await page.route('**/graphql', async (route) => {
        let query: string | undefined;
        try {
            query = (route.request().postDataJSON() as { query?: string } | null)?.query;
        } catch {
            query = undefined;
        }
        if (query?.includes(mutationName)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ errors: [{ message }] }),
            });
            return;
        }
        await route.continue();
    });
}

test('populateRace: the alert carries the server\'s own sentence', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Populate Refusal E2E');
    const message = 'The demo allows at most 40 racers per Populate Test Data call.';
    await refuseMutation(page, 'populateRace', message);

    await page.goto(`/race/${raceId}`);
    await page.locator('.split-btn-arrow').click();
    await page.getByText(/Populate Test Data/i).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    const alert = page.getByRole('dialog', { name: 'Error' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(message);
    // The old fixed string this replaced — asserting its absence is what
    // would have caught #1092 before it shipped.
    await expect(alert).not.toContainText('Failed to populate test racers');
});

test('uploadImage: the alert carries the server\'s own sentence', async ({ page }) => {
    const { raceId } = await seedRace(page, 'Upload Refusal E2E');
    const message = 'uploadImage is not available on the demo';
    await refuseMutation(page, 'uploadImage', message);

    await page.goto(`/race/${raceId}`);
    await page.getByRole('button', { name: /^Add Racer$/ }).click();

    const form = page.locator('form');
    await form.getByLabel('First Name').fill('Robin');
    await form.getByLabel('Last Name').fill('Rivera');

    const fileInput = page.locator('#racer-file');
    await fileInput.setInputFiles({
        name: 'car.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
        ),
    });

    const alert = page.getByRole('dialog', { name: 'Error' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(message);
    // The old fixed string this replaced, which told the operator to retry
    // something retrying could never fix.
    await expect(alert).not.toContainText('Please try again');
});
