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
 *
 * Scoped to the first track's own controls rather than to the page. Tracks are
 * *global* state on the shared backend — unlike a race, which each spec seeds
 * for itself — so any other spec that adds one puts a second Timer Type select
 * on this page, and an unscoped `getByLabel` then matches two.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured, gql } from './support';

/** This spec's own track, so nothing it does reaches anybody else's race. */
const TRACK_NAME = 'Timer Model Track';

test('a timer model can be chosen, and the undetectable one is marked', async ({ page }) => {
    await ensureConfigured(page);

    // A track of its own. This test switches a track off the fake timer and
    // onto backend auto-detect, and does not switch it back — on the shared
    // track that leaves every later spec arming heats against a probe of the
    // machine's serial ports. It survived only because this file happens to
    // sort near the end of an alphabetical, single-worker run, which is not a
    // property anybody should have to know about.
    await gql(
        page,
        `mutation TimerModelTrack($track: TrackInput!) { createTrack(track: $track) { id } }`,
        { track: { name: TRACK_NAME, laneCount: 4, timerType: 'FAKE' } },
    );

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');
    // A configured install shows one settings section at a time; the timer
    // controls are on a track's card, under Tracks.
    await page.getByTestId('settings-nav-tracks').click();

    // Found by the name in its own input, and every lookup below is scoped
    // inside it — the ids on these controls carry the card's *index*, which
    // says nothing about which track it is once specs run at once.
    const card = page
        .getByTestId(/track-card-\d+/)
        .filter({ has: page.locator(`input[value="${TRACK_NAME}"]`) });
    await expect(card).toHaveCount(1);

    // No model to pick on the fake timer: it is chosen by transport, and
    // offering it in both places would let a track ask for a fake timer over a
    // real serial port.
    const timerType = card.locator('select[id^="track-timer-type-"]');
    const picker = card.locator('select[id^="track-model-"]');
    await expect(timerType).toBeVisible();
    await expect(picker).toHaveCount(0);

    await timerType.selectOption('AUTO_DETECT_BACKEND');
    await expect(picker).toBeVisible();

    // Value alongside label: the label is what the operator picks by, the
    // value is the profile key that has to survive to the database — and
    // they are not the same string, so a read-back that only checks
    // truthiness would pass for *any* profile, not the one chosen.
    const options = await picker.locator('option').evaluateAll((opts) =>
        opts.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent ?? '' })),
    );
    // Detection is the default, and stays first.
    expect(options[0].label).toBe('Detect automatically');
    // Exactly the profiles a probe cannot find are flagged, and at least one
    // is — if none were, this feature would have nothing to justify it.
    const undetectable = options.filter((o) => o.label.includes('must be chosen'));
    expect(undetectable.length).toBeGreaterThan(0);
    const chosen = undetectable[0];

    await picker.selectOption({ label: chosen.label });

    // The provenance of whatever was picked, because "we have a profile for
    // your timer" and "your timer is known to work" are different claims.
    await expect(
        card.getByText('This model cannot answer an identifying question', { exact: false }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Save Settings/ }).click();

    await expect
        .poll(async () => {
            // Read back through `initialConfig`, which is what the settings
            // page renders from — `Query.tracks` is a different resolver and
            // need not agree on order. Found by name rather than by position,
            // for the same reason the card above is.
            const data = await gql<{
                initialConfig: { tracks: { name: string; timerProfile: string | null }[] };
            }>(page, `query { initialConfig { tracks { name timerProfile } } }`);
            return data.initialConfig.tracks.find((t) => t.name === TRACK_NAME)?.timerProfile;
        }, { timeout: 30000 })
        // Equal to the profile *chosen*, not merely truthy — a save that
        // silently kept the previous profile, or picked a different
        // undetectable one, would still satisfy toBeTruthy().
        .toBe(chosen.value);
});

test('a newly added track is titled Track N until named, and retitles live as you type (#1251)', async ({ page }) => {
    await ensureConfigured(page);

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('settings-nav-tracks').click();

    // Tracks are global state, so the shared backend can already hold any
    // number of them by the time this runs beside other specs — the new
    // card's fallback title is `Track ${n}` where `n` is its own 1-based
    // position, not literally "Track 2". Read the count that is actually
    // there rather than assuming one.
    const cards = page.getByTestId(/track-card-\d+/);
    const countBefore = await cards.count();

    await page.getByRole('button', { name: '+ Add Another Track' }).click();
    await expect(cards).toHaveCount(countBefore + 1);

    // The newly added card is the last one on the page — `addTrack` appends
    // rather than inserting — and `TrackCard`'s own fallback (`track.name.
    // trim() || \`Track ${index + 1}\``) agrees with the same number
    // `addTrack` itself pre-fills the Track Name box with, so the two never
    // disagree in practice; this test still reads the title through its own
    // testid, not the input, so it fails if that ever stops being true.
    const newCard = cards.nth(countBefore);
    const title = newCard.getByTestId(/track-card-title-\d+/);
    const expectedFallback = `Track ${countBefore + 1}`;
    await expect(title).toHaveText(expectedFallback);

    // Typing a name retitles the card live — it is derived from the same
    // state the Track Name input holds, no separate mutation or round trip.
    const nameInput = newCard.locator('input[id^="track-name-"]');
    await nameInput.fill('Regatta Lane');
    await expect(title).toHaveText('Regatta Lane');

    // Clearing the name back to blank falls back to the same Track N text.
    await nameInput.fill('');
    await expect(title).toHaveText(expectedFallback);

    // Never saved — this track never reaches the database, so it leaves
    // nothing behind for another spec's shared-track assumptions to trip on.
});

test('lanes in service sits under the lane count, and looks different from lane colours (#1252)', async ({ page }) => {
    await ensureConfigured(page);

    await page.goto('/system-settings');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('settings-nav-tracks').click();

    // The same track the first test in this file uses — found by name, not
    // position, same as every other lookup here.
    const card = page
        .getByTestId(/track-card-\d+/)
        .filter({ has: page.locator(`input[value="${TRACK_NAME}"]`) });
    await expect(card).toHaveCount(1);

    // Order: the "Lanes in service" panel's own top edge sits below the lane
    // count input and above Length (Feet) — a real layout assertion a unit
    // test's jsdom cannot make, since jsdom lays nothing out.
    const lanesInput = card.locator('input[id^="track-lanes-"]');
    const lanesInService = card.getByText('Lanes in service');
    const lengthInput = card.locator('input[id^="track-length-"]');

    const [lanesBox, serviceBox, lengthBox] = await Promise.all([
        lanesInput.boundingBox(),
        lanesInService.boundingBox(),
        lengthInput.boundingBox(),
    ]);
    expect(lanesBox).not.toBeNull();
    expect(serviceBox).not.toBeNull();
    expect(lengthBox).not.toBeNull();
    expect(serviceBox!.y).toBeGreaterThan(lanesBox!.y);
    expect(lengthBox!.y).toBeGreaterThan(serviceBox!.y);

    // Look: the two chip rows read as different tools before any state
    // changes — a squared checkbox chip for lanes in service, a circular
    // swatch for lane colours — not the same bordered pill twice over.
    const serviceChip = card.locator('.lane-service-chip').first();
    const colourSwatch = card.locator('.lane-colour-swatch').first();
    await expect(serviceChip).toBeVisible();
    await expect(colourSwatch).toBeVisible();
    const [serviceRadius, swatchRadius] = await Promise.all([
        serviceChip.evaluate((el) => getComputedStyle(el).borderRadius),
        colourSwatch.evaluate((el) => getComputedStyle(el).borderRadius),
    ]);
    expect(serviceRadius).not.toBe(swatchRadius);
});
