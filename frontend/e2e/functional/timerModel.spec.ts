/**
 * Choosing a timer model (#143).
 *
 * Detection covers six of the seven real profiles. The NewBold family answers
 * no identifying question, so before this it shipped and could not be reached:
 * `TimerType` offered three transports and nothing said *which timer*, and a
 * hand-entered port fell back to the MicroWizard's 9600 8-N-1 — which would
 * have read a NewBold's 1200 7-2 port as noise.
 *
 * The rule under test is that the operator can say what they have, and that it
 * survives to the database. What the backend then does with it is unit-tested
 * in `test_timer_model_choice.py`; this is the part no unit test can see —
 * that the control exists, is only offered when it means something, and that
 * what it sends comes back.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql } from './support';

test('a timer model can be chosen, and the undetectable one is marked', async ({ page }) => {
    await ensureConfigured(page);
    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');

    // No model to pick on the fake timer: it is chosen by transport, and
    // offering it in both places would let a track ask for a fake timer over a
    // real serial port.
    await expect(page.getByLabel(/Timer Model/)).toHaveCount(0);

    await page.getByLabel('Timer Type').selectOption('AUTO_DETECT_BACKEND');
    const picker = page.getByLabel(/Timer Model/);
    await expect(picker).toBeVisible();

    const options = await picker.locator('option').allInnerTexts();
    // Detection is the default, and stays first.
    expect(options[0]).toBe('Detect automatically');
    // Exactly the profiles a probe cannot find are flagged, and at least one
    // is — if none were, this feature would have nothing to justify it.
    const undetectable = options.filter((o) => o.includes('must be chosen'));
    expect(undetectable.length).toBeGreaterThan(0);

    await picker.selectOption({ label: undetectable[0] });

    // The provenance of whatever was picked, because "we have a profile for
    // your timer" and "your timer is known to work" are different claims.
    await expect(
        page.getByText('This model cannot answer an identifying question', { exact: false }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Save Settings/ }).click();

    await expect
        .poll(async () => {
            const data = await gql<{ tracks: { timerProfile: string | null }[] }>(
                page,
                `query { tracks { timerProfile } }`,
            );
            return data.tracks[0].timerProfile;
        }, { timeout: 30000 })
        .toBeTruthy();
});
