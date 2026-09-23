/**
 * A no-timer track says which scoring to pick, in the wizard and the race
 * form (#1324).
 *
 * `raceSettingsSections.test.ts` covers `scoringNeedsATimerNote` in
 * isolation, and `RaceFormScoring.test.tsx`/`RaceSetupWizard.test.tsx`
 * cover it wired to a mocked track query. This is the one thing neither can
 * see: a track actually saved with `timerType: NONE`, read back through a
 * real GraphQL round trip, showing the note on the wizard's Details step
 * (Timed is the default scoring strategy, so it fires the moment that
 * track is chosen) and again later when the resulting race is reopened for
 * editing — the issue's own reason for putting the second signpost in the
 * edit form too: a race can be edited after creation, or its track's timer
 * type can change later, and neither is the moment the race was first set
 * up.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql, openSetupWizardAtKind, attemptSuffix } from './support';

const NOTE = /no electronic timer/i;

test('the Scoring section names the no-timer signpost, at creation and again on edit', async ({
    page,
}) => {
    await ensureConfigured(page);

    // A track of its own, named fresh for this attempt (#1318) — tracks are
    // global state on the shared backend, so a fixed name would collide
    // with a retry or another attempt's leftover row.
    const trackName = `E2E No-Timer Track${attemptSuffix()}`;
    await gql(
        page,
        `mutation NoTimerTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: trackName, laneCount: 4, timerType: 'NONE' } },
    );

    const raceName = `No-Timer Scoring Race${attemptSuffix()}`;

    await openSetupWizardAtKind(page);
    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    await page.getByTestId('setup-next').click();
    await expect(page.getByLabel('Event Name')).toBeVisible();

    // Nothing about the note yet — the wizard's own default track is
    // whichever the worker's pool track happens to be, not this one.
    await page.getByLabel('Track / Timer').selectOption({ label: trackName });

    const scoring = page.getByTestId('race-section-scoring');
    await expect(scoring.getByText(NOTE)).toBeVisible();
    // Informing, not defaulting (the issue's own words): Timed is still
    // the untouched default, and nothing about the note disables Create
    // Race.
    await expect(page.getByRole('radio', { name: /^Timed \(average\)/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Create Race' })).toBeEnabled();

    await page.getByLabel('Event Name').fill(raceName);
    await page.getByRole('button', { name: 'Create Race' }).click();
    await expect(page.getByRole('heading', { name: raceName })).toBeVisible();

    // Reopen the same race for editing — the second signpost, in the race
    // form's own Scoring section, must fire here too.
    await page.getByRole('button', { name: /Edit race/ }).click();
    const form = page.locator('form');
    await form.getByTestId('race-settings-nav-scoring').click();
    await expect(form.getByTestId('race-section-scoring').getByText(NOTE)).toBeVisible();
});
