import { test, expect, jitter } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCREENSHOT_BACKEND_URL } from '../environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * One of the app's own sample images, as a data URL.
 *
 * Read from disk rather than inlined: these are the illustrations `populateRace`
 * hands out, so a screenshot seeded with them looks like a real event rather
 * than like a test fixture.
 */
function sampleImage(kind: 'racers' | 'cars'): string {
  const dir = path.resolve(__dirname, '../../../backend/assets/defaults', kind);
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()[0];
  const data = fs.readFileSync(path.join(dir, file)).toString('base64');
  return `data:image/png;base64,${data}`;
}

async function gqlRequest(
  page: import('@playwright/test').Page,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await page.request.post(`${SCREENSHOT_BACKEND_URL}/graphql`, {
    data: JSON.stringify({ query, variables }),
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

test('take screenshots', async ({ page, browser }) => {
  const screenshotsDir = path.resolve(__dirname, '../../../docs/assets/screenshots');
  fs.mkdirSync(path.join(screenshotsDir, 'getting-started'), { recursive: true });
  fs.mkdirSync(path.join(screenshotsDir, 'race-setup'), { recursive: true });

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');

  // wait for either Home Page or System Settings
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/system-settings')) {
    await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/02-system-settings.png') });
    await page.getByLabel('Organization Name').fill('My Pack');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await page.waitForURL('**/', { waitUntil: 'networkidle' });
  }

  await expect(page.getByRole('heading', { name: 'Welcome to Trusty Track' })).toBeVisible();

  // Start from a clean slate whichever way this spec is run. Run alone it
  // gets a virgin backend; run with the others (what CI does) the earlier
  // specs' races are still here — on the Home page, where 01's caption says
  // "before any races exist", and on this race's track, where their times
  // would become the record baseline and change what the record banner says
  // between a single-spec run and a full one.
  const leftovers = await gqlRequest(page, `query { races { id } }`);
  for (const race of leftovers.races ?? []) {
    await gqlRequest(page, `mutation Del($id: Int!) { deleteRace(id: $id) }`, { id: race.id });
  }

  // The record this race will break, owned by this spec so the banner in
  // observation/07 and /10 says the same thing on every run: slower than any
  // winner the seeded fake timer produces, and set at an event that reads as
  // real history.
  const trackForRecord = await gqlRequest(page, `query { tracks { id } }`);
  await gqlRequest(
    page,
    `mutation Rec($trackId: Int!, $record: HistoricalTrackRecordInput!) {
      createTrackRecord(trackId: $trackId, record: $record) { id }
    }`,
    {
      trackId: trackForRecord.tracks[0].id,
      record: {
        timeSeconds: 3.899,
        racerName: 'Marcus Reyes',
        carNumber: 27,
        raceName: 'Pinewood Derby 2019',
        raceDate: '2019-03-16',
      },
    },
  );

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Welcome to Trusty Track' })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/01-home-page.png') });

  await page.getByRole('button', { name: /Create New Race/i }).click();
  // Wait for modal animation
  await expect(page.getByRole('heading', { name: 'Create New Race Event' })).toBeVisible();
  await page.waitForTimeout(500); // wait for modal animation
  await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/03-new-race-form.png') });

  await page.getByPlaceholder('e.g. 2024 Pinewood Derby').fill('2026 Pinewood Derby');
  await page.locator('input[type="datetime-local"]').fill('2026-03-01T10:00');
  await page.getByPlaceholder('e.g. School Gym').fill('School Gym');
  await page.getByRole('button', { name: 'Create Race' }).click();

  // Creating a race opens it. This used to leave you on Home to go and find
  // the race you had just named, and the spec clicked through by hand.
  await page.waitForURL('**/race/*');
  await page.waitForLoadState('networkidle');
  // Read the id rather than assuming 1. Every docs spec creates its own race
  // against one shared backend, so "the race this spec made" is only id 1 when
  // this spec happens to run first — and running them together is what CI does.
  const raceId = Number(page.url().match(/\/race\/(\d+)/)![1]);

  /** Close the round summary if it is up.
   *
   * It appears whenever a championship round's field is decided, which happens
   * more than once in this run — after the qualifying round completes, and
   * again when `advanceRound` fills the final. It is modal, so leaving it up
   * sends every later click to its backdrop instead of the page.
   */
  const dismissRoundSummary = async () => {
    const summary = page.getByRole('dialog', { name: 'Round Complete!' });
    if (await summary.isVisible()) {
      await summary.getByRole('button', { name: '\u00d7' }).click();
      await expect(summary).toBeHidden();
    }
  };
  await expect(page.getByText('2026 Pinewood Derby')).toBeVisible();
  await page.waitForTimeout(500); // render elements

  await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/05-race-details-empty.png') });
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/01-race-details-overview.png') });

  // Manage Dens, now behind the roster overflow menu (#186) — it is a
  // set-up action rather than one reached for during an event.
  await page.getByTestId('roster-more-menu').click();
  await page.getByRole('button', { name: /Manage Dens/i }).click();
  await expect(page.getByRole('heading', { name: 'Manage Dens' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/04-den-management.png') });
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/02-den-manager-ui.png') });

  await page.getByRole('button', { name: /Add New Den/i }).click();
  await expect(page.getByRole('button', { name: 'Add Den' })).toBeVisible(); // Just waiting for form
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/03-add-den-form.png') });

  // Close Add Den by canceling -> Close Manage Dens
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Add Racer Manually
  await page.getByRole('button', { name: 'Add Racer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Racer' })).toBeVisible(); // Just waiting for form
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/04-add-racer-form.png') });

  // Canceling the add racer manual flow since we will auto populate
  await page.getByRole('button', { name: /Cancel/i }).click();
  await page.waitForTimeout(300);

  // Racer list manual view (emptyish view was already captured as 05-race-details-empty)
  // we will just take another empty shot
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/05-racer-list-manual.png') });

  // Test CSV Import dialog
  await page.locator('.split-btn-arrow').click(); // The dropdown arrow
  await page.getByText(/Import from CSV/i).click();
  await expect(page.getByRole('heading', { name: 'Import Racers from CSV' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/06-csv-import-dialog.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(300);

  // Auto populate
  await page.locator('.split-btn-arrow').click();
  await page.getByText(/Populate Test Data/i).click();
  await expect(page.getByRole('heading', { name: 'Populate Test Data' })).toBeVisible();

  // "Check In Automatically" is deliberately left off. The check-in
  // screenshots below are of racers being checked in, and there is nothing to
  // photograph once they already are. The schedule needs them checked in, and
  // that happens through the API further down, after those shots are taken.
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // wait for it to generate and close modal
  await page.waitForResponse(response => response.url().includes('graphql') && response.status() === 200, { timeout: 30000 });
  await page.waitForTimeout(3000); // Give time for images to load

  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/08-racer-list-after-import.png') });

  // The selection bar. There is no Bulk Actions button to open any more
  // (#186) — selecting racers is what brings the actions on screen.
  await page.locator('input[type="checkbox"]').nth(1).click();
  await page.locator('input[type="checkbox"]').nth(2).click();
  await expect(page.getByTestId('roster-selection-bar')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/09-selection-bar.png') });

  // Final Roster Review - maybe group by den
  await page.getByTestId('clear-selection').click();
  await page.waitForTimeout(300);
  await page.locator('.toggle-switch').click(); // Toggle "Group by den"
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/10-final-roster-review.png') });

  // ============================================================
  // PART 1: RACE-DAY SCREENSHOTS
  // ============================================================
  fs.mkdirSync(path.join(screenshotsDir, 'race-day'), { recursive: true });
  fs.mkdirSync(path.join(screenshotsDir, 'observation'), { recursive: true });
  fs.mkdirSync(path.join(screenshotsDir, 'race-stats'), { recursive: true });

  const BACKEND_URL = SCREENSHOT_BACKEND_URL;

  // Undo the selection and the grouping the roster shots left behind. By
  // reloading rather than by clicking the same checkboxes again: both are local
  // component state, and grouping *moves* the checkboxes, so undoing by
  // position unticked the wrong ones and left the check-in screenshots showing
  // a roster with 19 racers selected and a bulk-actions bar up.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // --- A. CHECK-IN SCREENSHOTS ---

  // 01: full roster with all "Check In" buttons visible
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/01-check-in-status.png') });

  // Click "Check In" on first racer to open modal
  await page.getByRole('button', { name: 'Check In' }).first().click();
  await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);

  // Toggle inspection switch ON inside the modal (modal is appended last to body via portal)
  await page.locator('label.toggle-switch').last().click();
  await page.waitForTimeout(300);

  // 02: modal open with inspection toggle ON
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/02-check-in-modal-inspected.png') });

  // 03: same modal (racer photo visible from populate data)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/03-check-in-modal-with-photo.png') });

  // Click "Save Check-in"
  await page.getByRole('button', { name: 'Save Check-in' }).click();
  await page.waitForTimeout(1000);

  // 04: racer list showing one racer "Checked In"
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/04-racer-list-after-check-in.png') });

  // 05: a second racer checked in, so this shows *progress* rather than being
  // a second copy of 04 (#144).
  await page.getByRole('button', { name: 'Check In' }).first().click();
  await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeVisible({ timeout: 5000 });
  await page.locator('label.toggle-switch').last().click();
  await page.getByRole('button', { name: 'Save Check-in' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/05-check-in-progress.png') });

  // --- B. RACE CONTROL — SCHEDULE TAB ---

  // Navigate to Race Control via secondary nav "Control" link
  await page.getByRole('link', { name: 'Control' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // 06: race control empty (no rounds yet)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/06-race-control-empty.png') });

  // Open round creation wizard
  await page.getByRole('button', { name: /Start Round Creation Wizard/i }).click();
  await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);

  // 07: wizard step 1 (General Rounds)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/07-round-wizard-step1.png') });

  // Click "Next" to go to step 2
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(300);

  // 08: wizard step 2 (Championships)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/08-round-wizard-step2.png') });

  // Click "Next" to go to step 3
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(300);

  // 09: wizard step 3 (Review)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/09-round-wizard-step3.png') });

  // Before generating schedule, mark all racers as passed inspection via backend API.
  // generate_heats_for_round filters racers by car_passed_inspection = True, so we need
  // at least 2 racers checked in (passed inspection) or the mutation returns an error.
  const allRacersResp = await page.request.post(`${BACKEND_URL}/graphql`, {
    data: JSON.stringify({ query: `query { race(raceId: ${raceId}) { racers { id } } }` }),
    headers: { 'Content-Type': 'application/json' },
  });
  const allRacersJson = await allRacersResp.json();
  const racerIds = allRacersJson.data.race.racers.map((r: { id: number }) => r.id);
  for (const racerId of racerIds) {
    await page.request.post(`${BACKEND_URL}/graphql`, {
      data: JSON.stringify({
        query: `mutation CheckIn($id: Int!, $passedInspection: Boolean!) {
          checkInRacer(id: $id, passedInspection: $passedInspection, weight: null) { id }
        }`,
        variables: { id: racerId, passedInspection: true },
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Click "Generate Schedule" and wait for it to complete
  await page.getByRole('button', { name: 'Generate Schedule' }).click();
  await page.waitForResponse(
    response => response.url().includes('graphql') && response.status() === 200,
    { timeout: 30000 }
  );
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 10: schedule management with generated heats
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/10-schedule-management.png') });

  // 11: same view showing drag handles on heat cards
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/11-heat-reordering.png') });

  // --- C. RACE CONTROL — RACE TAB (FIRST HEAT) ---

  // Navigate to race tab (button inside the Race Control tab switcher)
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await page.waitForTimeout(500);

  // Wait for heat to auto-prepare and reach ARMED state ("Ready to start")
  await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 15000 });

  // 12: race execution view showing heat with lane assignments
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/12-race-execution-current-heat.png') });

  // 13: the Fake Timer Controls panel itself. It was a second copy of 12, so
  // the close-up the caption describes did not exist (#144).
  const timerPanel = page.locator('.fake-timer-mole');
  const panelBox = await timerPanel.boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'race-day/13-fake-timer-controls.png'),
    ...(panelBox
      ? {
          clip: {
            x: Math.max(0, panelBox.x - 20),
            y: Math.max(0, panelBox.y - 20),
            width: Math.min(panelBox.width + 40, 1200 - Math.max(0, panelBox.x - 20)),
            height: panelBox.height + 40,
          },
        }
      : {}),
  });

  // Start the timer and wait for auto-finish (3-5s) plus buffer
  await page.getByRole('button', { name: 'Start Timer' }).click();
  await page.waitForTimeout(7000);

  // 14: heat complete with times and placements
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/14-heat-results.png') });

  // The staging panels, shot here rather than in the observation section below
  // (#209). Both only exist while there is a heat after next, and by the time
  // this spec reaches the observation shots the race is on the last heat of
  // its final — so a picture taken there can only ever show one of them, and
  // the caption beneath it would be a claim about a panel that is not in it.
  await page.goto(`/race/${raceId}/observation`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.heat-cards-layout')).toHaveAttribute('data-on-deck-count', '2');
  const staging = await page.locator('.heat-cards-layout').boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/04-on-deck-panel.png'),
    ...(staging
      ? { clip: { x: staging.x, y: staging.y, width: staging.width, height: staging.height } }
      : {}),
  });
  await page.goto(`/race/${raceId}/control/race`);
  await page.waitForLoadState('networkidle');

  // Navigate to standings to capture live leaderboard mid-race.
  // Standings, not Stats: this shot is captioned as the leaderboard, and
  // clicking Stats made it a picture of the lane-fairness chart (#144).
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // 15: live leaderboard (standings after first heat)
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/15-live-leaderboard.png') });

  // --- D. COMPLETE QUALIFYING ROUND via backend API ---
  // Query the race to find all qualifying heats and force-complete them
  const roundsResp = await page.request.post(`${BACKEND_URL}/graphql`, {
    data: JSON.stringify({
      query: `query { rounds(raceId: ${raceId}) { id roundNumber advancementSource } }`
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const roundsJson = await roundsResp.json();
  const rounds = roundsJson.data.rounds as Array<{ id: number; roundNumber: number; advancementSource: string | null }>;
  const qualifyingRound = rounds.find(r => r.roundNumber === 1)!;
  const championshipRound = rounds.find(r => r.advancementSource !== null);

  // Get all heats in the qualifying round
  const heatsResp = await page.request.post(`${BACKEND_URL}/graphql`, {
    data: JSON.stringify({
      query: `query {
        race(raceId: ${raceId}) {
          heats { id roundId lanes { lane racerId placeholderSlot time place skipped } }
        }
      }`
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const heatsJson = await heatsResp.json();
  type Lane = {
    lane: number;
    racerId: number | null;
    placeholderSlot: number | null;
    time: number | null;
    place: number | null;
    skipped: boolean;
  };
  const allHeats = heatsJson.data.race.heats as Array<{ id: number; roundId: number; lanes: Lane[] }>;
  const qualifyingHeats = allHeats.filter(h => h.roundId === qualifyingRound.id);

  // Force-complete any remaining qualifying heats via updateHeatResult
  for (const [position, heat] of qualifyingHeats.entries()) {
    const lanes = heat.lanes;
    if (lanes.length === 0) continue; // no assignments
    if (lanes.some(l => l.time !== null)) continue; // already run

    // Fake times, sorted to decide places, then put back in lane order.
    //
    // The jitter is derived rather than drawn: `Math.random()` here was the
    // last thing making every standings, stats and observation screenshot
    // differ on every run. It only has to look unpatterned in a picture, and
    // it has to be the same picture next time.
    const timed = lanes.map((l, i) => ({
        ...l,
        // Keyed on the heat's *position*, not its id — ids depend on how many
        // races the specs before this one created, so a spec regenerated on
        // its own would produce different times from the same spec regenerated
        // alongside the others.
        time: 3.0 + i * 0.13 + jitter(`${position}:${l.lane}`),
    }));
    timed.sort((a, b) => a.time - b.time);
    const results = timed
      .map((l, idx) => ({ ...l, place: idx + 1 }))
      .sort((a, b) => a.lane - b.lane);

    await page.request.post(`${BACKEND_URL}/graphql`, {
      data: JSON.stringify({
        query: `mutation UpdateHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
          updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
        }`,
        variables: { heatId: heat.id, lanes: results }
      }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Those results were written straight to the backend, behind the client's
  // back, so reload before reading the screen again — otherwise the page is
  // rendering a race that finished several heats ago.
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Navigate back to Race Control race tab to screenshot post-round state
  await page.getByRole('link', { name: 'Control' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await page.waitForTimeout(1000);

  // 16: race execution state after qualifying round complete
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/16-round-completion-modal.png') });

  await dismissRoundSummary();

  // --- E. CHAMPIONSHIP ROUND ---

  // Advance the championship round (replace placeholder IDs with real racer IDs)
  if (championshipRound) {
    await page.request.post(`${BACKEND_URL}/graphql`, {
      data: JSON.stringify({
        query: `mutation AdvanceRound($raceId: Int!, $roundId: Int!) {
          advanceRound(raceId: $raceId, roundId: $roundId)
        }`,
        variables: { raceId, roundId: championshipRound.id }
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    await page.waitForTimeout(500);
  }

  // Same again: `advanceRound` went straight to the backend.
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Navigate to Schedule tab to show championship schedule
  await page.getByRole('link', { name: 'Control' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // 17: championship schedule.
  // Scrolled to, because the page opens at the qualifying round and the
  // championship one is below the fold — so this used to be a picture of the
  // round it is not named after (#144).
  const championshipTable = page.locator('table').last();
  await championshipTable.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/17-championship-schedule.png') });

  // Switch to Race tab to run championship heat
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await page.waitForTimeout(500);

  // Filling the final's field decided a round, so the summary is up again.
  // Dismissed *before* waiting on the timer: it is modal, and leaving it there
  // while waiting means fifteen seconds spent watching a covered page.
  await dismissRoundSummary();

  // Wait for championship heat to auto-prepare
  await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 15000 });

  // Run the championship heat
  await page.getByRole('button', { name: 'Start Timer' }).click();
  await page.waitForTimeout(7000);

  // Navigate to Standings page for final standings
  await page.goto(`/race/${raceId}/standings`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 18: final standings
  await page.screenshot({ path: path.join(screenshotsDir, 'race-day/18-final-standings.png') });

  // ============================================================
  // PART 2: OBSERVATION SCREENSHOTS
  // ============================================================

  // Navigate to observation page. Opening it also registers this browser as a
  // display (#174), which is what puts a row in the operator's list below.
  await page.goto(`/race/${raceId}/observation`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 01: full observation page
  await page.screenshot({ path: path.join(screenshotsDir, 'observation/01-observation-overview.png') });

  // 09: the photo slideshow (#175). The photos are seeded here through the API
  // rather than relied upon from the populate step far above: this shot is the
  // only one that depends on a racer having an image, and a screenshot that
  // silently documents the empty state is exactly the failure the audit of
  // this suite kept turning up.
  const roster = await gqlRequest(page, `query Ph($id: Int!) {
    race(raceId: $id) { racers { id firstName lastName racerImageUrl carImageUrl } }
  }`, { id: raceId });
  const needsPhoto = (roster.race?.racers ?? []).filter(
    (r: { racerImageUrl?: string; carImageUrl?: string }) => !r.racerImageUrl && !r.carImageUrl,
  );
  const racerPhoto = sampleImage('racers');
  const carPhoto = sampleImage('cars');
  for (const racer of needsPhoto.slice(0, 4)) {
    const head = await gqlRequest(page, `mutation Up($d: String!) { uploadImage(dataUrl: $d) }`, {
      d: racerPhoto,
    });
    const car = await gqlRequest(page, `mutation Up($d: String!) { uploadImage(dataUrl: $d) }`, {
      d: carPhoto,
    });
    await gqlRequest(page, `mutation Set($id: Int!, $racer: RacerInput!) {
      updateRacer(id: $id, racer: $racer) { id }
    }`, {
      id: racer.id,
      racer: {
        firstName: racer.firstName,
        lastName: racer.lastName,
        racerImageUrl: head.uploadImage,
        carImageUrl: car.uploadImage,
      },
    });
  }

  await page.goto(`/race/${raceId}/observation?view=slideshow`);
  // Wait for a slide rather than for the network: the empty state and the
  // loading state look alike at a glance, and a screenshot taken during the
  // first fetch would document the wrong one.
  await expect(page.getByTestId('slideshow')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(screenshotsDir, 'observation/09-slideshow.png') });

  // 08: the operator's list of displays (#174). A display registers by holding
  // its subscription open, so the screen has to stay open in a second context
  // while this page is captured — navigating this one away closes the socket
  // and the row honestly, but unhelpfully, reads "Not connected".
  //
  // The list is composed deliberately rather than photographed as it has
  // accumulated. Every context that has sat on an observation page is
  // registered by now, so the row count followed how many this run happened
  // to open — which differs between running this spec alone and running the
  // whole set, and is exactly the churn the seeding work exists to prevent.
  //
  // This tab goes to Race Control *first*: it is a display too while it sits
  // on the Live page, and clearing one whose socket is still open just brings
  // it back.
  await page.goto(`/race/${raceId}/control/displays`);
  await page.waitForLoadState('networkidle');

  const registered = await gqlRequest(
    page,
    `query KnownDisplays($id: Int!) { displays(raceId: $id) { displayId } }`,
    { id: raceId },
  );
  for (const known of registered.displays ?? []) {
    await gqlRequest(
      page,
      `mutation Forget($id: String!) { forgetDisplay(displayId: $id) }`,
      { id: known.displayId },
    );
  }

  // A screen that has since dropped off the wifi, which is the row the prose
  // beside this picture is about — and the reason nothing removes one
  // automatically.
  const goneContext = await browser.newContext();
  const goneScreen = await goneContext.newPage();
  await goneScreen.goto(`/race/${raceId}/observation`);
  await goneScreen.waitForLoadState('networkidle');
  await goneScreen.waitForTimeout(300);
  await goneContext.close();

  const displayContext = await browser.newContext();
  const audienceScreen = await displayContext.newPage();
  await audienceScreen.goto(`/race/${raceId}/observation`);
  await audienceScreen.waitForLoadState('networkidle');
  await audienceScreen.waitForTimeout(500);

  // Name them, which is what the page beside this picture tells operators to
  // do — "a list of Display 1, Display 2, Display 3 is no help when you are
  // trying to change the one at the back".
  const toName = await gqlRequest(
    page,
    `query NameDisplays($id: Int!) { displays(raceId: $id) { displayId connected } }`,
    { id: raceId },
  );
  for (const known of toName.displays ?? []) {
    await gqlRequest(
      page,
      `mutation Rename($id: String!, $name: String!) { renameDisplay(displayId: $id, name: $name) { displayId } }`,
      { id: known.displayId, name: known.connected ? 'Gym north' : 'By the doors' },
    );
  }

  // The ceremony is offered as a view only once a race has an award to
  // announce, so this race needs one before picture 11 can be taken. Seeded
  // before the reload below, which is what the panel re-reads it on — and it
  // is the operator's own order anyway: set the awards up, then put the
  // ceremony on a screen.
  await gqlRequest(
    page,
    `mutation SeedAward($id: Int!, $award: AwardInput!) {
       createAward(raceId: $id, award: $award) { id }
     }`,
    { id: raceId, award: { name: 'Fastest Car', kind: 'SPEED', source: 'PACK', place: 1 } },
  );

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsDir, 'observation/08-displays-panel.png') });

  // 11: the ceremony controls on a display row. Taken after 08 rather than
  // instead of it — 08 is the panel's ordinary look, and a row parked on the
  // ceremony is not it. Assigning navigates the audience screen to the
  // ceremony route, which is fine: it is closed a moment later.
  const displayRow = page.locator('[data-testid^="display-"]').first();
  await expect(displayRow.getByText('Gym north')).toBeVisible();
  await displayRow.getByRole('combobox').selectOption('AWARDS');
  await expect(displayRow.getByRole('button', { name: /Next award/ })).toBeVisible();
  await page.waitForTimeout(500);
  const rowBox = await displayRow.boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/11-ceremony-controls.png'),
    ...(rowBox
      ? { clip: { x: rowBox.x, y: rowBox.y, width: rowBox.width, height: rowBox.height } }
      : {}),
  });

  await displayContext.close();

  await page.goto(`/race/${raceId}/observation`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // 02: the race navigation, which is what the section around it is about —
  // finding the Live tab. It used to be a second copy of 01, captioned as
  // showing a URL that a Playwright screenshot cannot contain (#144).
  const raceNav = page.locator('nav').last();
  const navBox = await raceNav.boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/02-observation-url.png'),
    ...(navBox ? { clip: { x: 0, y: 0, width: 1200, height: navBox.y + navBox.height + 10 } } : {}),
  });

  // 03: "Now Racing" card area
  const nowRacingCard = page.locator('.heat-card').first();
  if (await nowRacingCard.isVisible()) {
    const box = await nowRacingCard.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'observation/03-now-racing-panel.png'),
        clip: { x: box.x, y: box.y, width: box.width, height: box.height }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'observation/03-now-racing-panel.png') });
  }

  // 04 (the staging panels) is taken earlier, mid preliminary round — see
  // the note there for why it cannot be shot from here.

  // Ensure Standings tab is active. This is the *observation page's* own
  // standings/timing tab, not the race-mode toggle that #186 removed — it is
  // still a button, and clicking the navigation link instead navigates away
  // from the page being screenshotted.
  await page.getByRole('button', { name: /Standings/i }).click();
  await page.waitForTimeout(500);

  // 05: the standings table itself, not another copy of the whole page (#144).
  const standingsTable = page.locator('table').first();
  await standingsTable.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const standingsBox = await standingsTable.boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/05-live-leaderboard.png'),
    ...(standingsBox
      ? { clip: { x: 0, y: standingsBox.y - 60, width: 1200, height: Math.min(standingsBox.height + 80, 700) } }
      : {}),
  });

  // 06: the "Launch Projector Mode" button, which is what the caption points
  // at — this was a fifth copy of the full page (#144).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const projectorButton = page.getByRole('button', { name: /Launch Projector Mode/i });
  const buttonBox = await projectorButton.boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/06-projector-mode-button.png'),
    ...(buttonBox
      ? { clip: { x: 0, y: 0, width: 1200, height: buttonBox.y + buttonBox.height + 20 } }
      : {}),
  });

  // 07: projector mode — open in new tab
  const newPagePromise = page.context().waitForEvent('page');
  await page.getByRole('button', { name: /Launch Projector Mode/i }).click();
  const projectorPage = await newPagePromise;
  await projectorPage.waitForLoadState('networkidle');
  await projectorPage.waitForTimeout(1500);
  await projectorPage.screenshot({ path: path.join(screenshotsDir, 'observation/07-projector-mode-full.png') });
  await projectorPage.close();

  // No 09. It was a sixth copy of the full page, captioned "without photos" —
  // which is honest only because this fixture has none, and is therefore
  // exactly what 01 already shows. That section points at 01 now (#144).

  // 10: the record banner on the Timing Stats view. The banner state is
  // already here: earlier specs raced on this same track, so their times are
  // the record as it stood before this race, and this race's fastest heat
  // beat it — deterministically, since every time above is seeded. The same
  // break is what puts the banner over the projector overlay in 07.
  await page.goto(`/race/${raceId}/observation?view=timing`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('timing-record-banner')).toBeVisible();
  await page.waitForTimeout(500);
  const recordBanner = await page.getByTestId('timing-record-banner').boundingBox();
  await page.screenshot({
    path: path.join(screenshotsDir, 'observation/10-record-banner.png'),
    ...(recordBanner
      ? { clip: { x: 0, y: Math.max(0, recordBanner.y - 70), width: 1200, height: recordBanner.height + 100 } }
      : {}),
  });

  // ============================================================
  // PART 3: RACE STATS SCREENSHOTS
  // ============================================================

  // Navigate to stats page
  await page.goto(`/race/${raceId}/stats`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 01: full stats page with Stats tab highlighted in nav
  await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/01-stats-tab-nav.png') });

  // 02: overview cards (top of page)
  const overviewCards = page.locator('.race-stats__overview-cards');
  if (await overviewCards.isVisible()) {
    const box = await overviewCards.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/02-overview-cards.png'),
        clip: { x: 0, y: box.y - 10, width: 1200, height: box.height + 20 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/02-overview-cards.png') });
  }

  // 03: lane fairness section
  const laneSection = page.locator('.race-stats__section').first();
  if (await laneSection.isVisible()) {
    await laneSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await laneSection.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/03-lane-fairness.png'),
        clip: { x: 0, y: box.y - 10, width: 1200, height: box.height + 20 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/03-lane-fairness.png') });
  }

  // 04: per-racer stats table
  const racerSection = page.locator('.race-stats__section').nth(1);
  if (await racerSection.isVisible()) {
    await racerSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await racerSection.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/04-per-racer-stats.png'),
        clip: { x: 0, y: box.y - 10, width: 1200, height: Math.min(box.height + 20, 600) }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/04-per-racer-stats.png') });
  }

  // 05: top moments cards. Scoped to the Top Moments section — the Track
  // Record card below uses the same highlights grid, so the bare class
  // matches twice.
  const momentsSection = page
    .locator('.race-stats__section')
    .filter({ hasText: 'Top Moments' })
    .locator('.race-stats__highlights');
  if (await momentsSection.isVisible()) {
    await momentsSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await momentsSection.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/05-top-moments.png'),
        clip: { x: 0, y: box.y - 40, width: 1200, height: box.height + 80 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/05-top-moments.png') });
  }

  // 09: the track record section — the fastest cars this track has ever
  // seen. In this seeded world there is only this race on the track, so
  // every entry is from it and the hero card carries its badge.
  const recordSection = page.getByTestId('track-record-section');
  if (await recordSection.isVisible()) {
    await recordSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const recordBox = await recordSection.boundingBox();
    if (recordBox) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/09-track-record.png'),
        clip: { x: 0, y: recordBox.y - 10, width: 1200, height: recordBox.height + 20 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/09-track-record.png') });
  }

  // 06: den comparison section
  const denSection = page.locator('.race-stats__section').filter({ hasText: 'Den Comparison' });
  if (await denSection.isVisible()) {
    await denSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await denSection.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/06-den-comparison.png'),
        clip: { x: 0, y: box.y - 10, width: 1200, height: box.height + 20 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/06-den-comparison.png') });
  }

  // 07: export buttons section
  const exportSection = page.locator('.race-stats__export-buttons');
  if (await exportSection.isVisible()) {
    await exportSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await exportSection.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'race-stats/07-export-buttons.png'),
        clip: { x: 0, y: Math.max(0, box.y - 50), width: 1200, height: box.height + 100 }
      });
    }
  } else {
    await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/07-export-buttons.png') });
  }

  // 08: full stats page screenshot (live/partial state)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-stats/08-stats-live-partial.png'), fullPage: true });
});
