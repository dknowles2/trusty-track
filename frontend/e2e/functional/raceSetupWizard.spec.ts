/**
 * The race setup wizard's step pills (#1087): a previously-visited step is
 * a real `<button>` now, and clicking it calls the same `goTo` that `Back`
 * already used — so a jump back to step 1 keeps whatever the operator has
 * typed on the way. `RaceSetupWizard.test.tsx` covers the wiring in detail;
 * this is the one thing that test cannot see — that the jump survives the
 * served page, the real GraphQL round trip and the normalized cache, the
 * same way the rest of the wizard already does.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- raceSetupWizard.spec.ts
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, openSetupWizardAtKind } from './support';

test('the first step pill jumps back to it, and Groups keeps its list', async ({ page }) => {
    await ensureConfigured(page);

    // Other specs share this backend and race concurrently, so a previous
    // race may or may not already exist — the start step (scratch vs. copy)
    // only exists once one does (`stepsFor`). Either way scratch is the
    // default, and stepping through with nothing changed reaches Groups.
    // `openSetupWizardAtKind` waits for whichever step shows before deciding
    // whether to step past it (#1199).
    await openSetupWizardAtKind(page);
    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    await expect(page.getByLabel('Den 1 name')).toHaveValue('Lion');

    await page.getByTestId('setup-next').click();
    await expect(page.getByLabel('Event Name')).toBeVisible();

    // Step 1's pill — Start if a previous race exists, Kind of event
    // otherwise — is a real button now; clicking it jumps straight back
    // rather than needing Back twice.
    await page.getByTestId('setup-step-pill-0').click();
    const start = page.getByTestId('setup-step-start');
    const kind = page.getByTestId('setup-step-kind');
    await expect(start.or(kind)).toBeVisible();
    const onStart = await start.isVisible();

    // Advancing again with nothing changed must land back on Groups with
    // its list intact — `seededFrom` is what stops a needless re-scaffold.
    if (onStart) {
        await page.getByTestId('setup-next').click();
        await expect(page.getByTestId('setup-step-kind')).toBeVisible();
    }
    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    await expect(page.getByLabel('Den 1 name')).toHaveValue('Lion');
});
