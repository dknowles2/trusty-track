/**
 * Setting a race up, and then running it: docs/getting-started.md,
 * docs/race-setup.md and docs/race-day.md.
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/race-day.spec.ts
 *
 * This used to be the whole documentation suite in one 900-line `test()` —
 * setup, race day, the audience displays and the stats page, each step
 * depending on the one before it. The last two only ever needed *a race that
 * had finished*, which the API builds in seconds, so they are their own specs
 * now (`screenshot-observation.spec.ts`, `screenshot-race-stats.spec.ts`) and
 * run beside this one instead of behind it. The first-run pictures moved to
 * `screenshot-first-run.spec.ts`, which is the setup project every other
 * project depends on.
 *
 * What is left is the one genuine chain: these screenshots are of states the
 * previous step produced, through the browser, the way an operator produces
 * them. Seeding a roster through the API would be faster and would photograph
 * a screen nobody had used.
 *
 * `observation/04` (the staging panels) is here rather than with the other
 * observation pictures: both panels only exist while there is a heat after
 * next, so it has to be taken mid-round.
 */

import { test, expect, jitter } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    type Heat,
    type Round,
    dismissRoundSummary,
    docsTrackId,
    ensureConfigured,
    gql,
} from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('take screenshots', async ({ page }) => {
    const screenshotsDir = path.resolve(__dirname, '../../../docs/assets/screenshots');
    for (const area of ['getting-started', 'race-setup', 'race-day', 'observation']) {
        fs.mkdirSync(path.join(screenshotsDir, area), { recursive: true });
    }

    await page.setViewportSize({ width: 1200, height: 800 });
    await ensureConfigured(page);
    await expect(page.getByRole('heading', { name: 'Welcome to Trusty Track' })).toBeVisible();

    await page.getByRole('button', { name: /Create New Race/i }).click();
    await expect(page.getByRole('heading', { name: 'Create New Race Event' })).toBeVisible();
    // The Track / Timer field says "Loading tracks..." until the tracks query
    // answers, and whether the picture catches that depends on the run.
    await expect(page.getByText('Loading tracks...')).toBeHidden();
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
    // against one shared backend, so "the race this spec made" is only id 1
    // when this spec happens to run first — and the specs now run at once.
    const raceId = Number(page.url().match(/\/race\/(\d+)/)![1]);

    // Pin the race to the shared four-lane fake-timer track. The form picks a
    // track for itself, and other specs add tracks of their own while this one
    // is running — a race that landed on the two-lane proxy track would
    // schedule two-lane heats and then wait forever for a timer that is a
    // WebSocket somebody else owns.
    // `RaceUpdateInput` drops every null, so naming only the track leaves the
    // rest of the race exactly as the form made it.
    await gql(
        page,
        `mutation PinRaceTrack($id: Int!, $race: RaceUpdateInput!) {
            updateRace(id: $id, race: $race) { id }
        }`,
        { id: raceId, race: { trackId: await docsTrackId(page) } },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('2026 Pinewood Derby')).toBeVisible();

    await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/05-race-details-empty.png') });
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/01-race-details-overview.png') });

    // Manage Dens, now behind the roster overflow menu (#186) — it is a
    // set-up action rather than one reached for during an event.
    await page.getByTestId('roster-more-menu').click();
    await page.getByRole('button', { name: /Manage Dens/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Dens' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/04-racing-group-management.png') });
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/02-racing-group-manager-ui.png') });

    await page.getByRole('button', { name: /Add New Den/i }).click();
    await expect(page.getByRole('button', { name: 'Add Den' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/03-add-racing-group-form.png') });

    // Close Add Den by cancelling, then close Manage Dens.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Add Den' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Manage Dens' })).toBeHidden();

    // Add Racer manually.
    await page.getByRole('button', { name: 'Add Racer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Racer' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/04-add-racer-form.png') });

    // Cancelled, because the roster is populated below rather than typed.
    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByRole('button', { name: 'Save Racer' })).toBeHidden();

    // The roster with nothing in it yet, from the racer-list section's angle.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/05-racer-list-manual.png') });

    // The CSV import dialog.
    await page.locator('.split-btn-arrow').click();
    await page.getByText(/Import from CSV/i).click();
    await expect(page.getByRole('heading', { name: 'Import Racers from CSV' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/06-csv-import-dialog.png') });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import Racers from CSV' })).toBeHidden();

    // Populate a believable roster.
    await page.locator('.split-btn-arrow').click();
    await page.getByText(/Populate Test Data/i).click();
    await expect(page.getByRole('heading', { name: 'Populate Test Data' })).toBeVisible();

    // "Check In Automatically" is deliberately left off. The check-in
    // screenshots below are of racers being checked in, and there is nothing
    // to photograph once they already are. The schedule needs them checked in,
    // and that happens through the API further down, after those shots are
    // taken.
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Populate Test Data' })).toBeHidden({
        timeout: 30000,
    });

    // Wait for the photographs rather than for a fixed three seconds. A
    // roster screenshot taken while the images are still arriving documents a
    // page of empty frames, and how long they take is a property of the
    // machine rather than of the app.
    await expect(page.locator('.racer-row').first()).toBeVisible();
    await page.waitForFunction(() =>
        Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
    );

    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/08-racer-list-after-import.png') });

    // The selection bar. There is no Bulk Actions button to open any more
    // (#186) — selecting racers is what brings the actions on screen.
    await page.locator('input[type="checkbox"]').nth(1).click();
    await page.locator('input[type="checkbox"]').nth(2).click();
    await expect(page.getByTestId('roster-selection-bar')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/09-selection-bar.png') });

    // The final roster review, grouped by racingGroup.
    await page.getByTestId('clear-selection').click();
    await expect(page.getByTestId('roster-selection-bar')).toBeHidden();
    await page.locator('.toggle-switch').click();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/10-final-roster-review.png') });

    // ============================================================
    // RACE DAY
    // ============================================================

    // Undo the selection and the grouping the roster shots left behind. By
    // reloading rather than by clicking the same checkboxes again: both are
    // local component state, and grouping *moves* the checkboxes, so undoing
    // by position unticked the wrong ones and left the check-in screenshots
    // showing a roster with 19 racers selected and a bulk-actions bar up.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.racer-row').first()).toBeVisible();

    // --- A. CHECK-IN ---

    // 01: the full roster, with every "Check In" button on screen.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/01-check-in-status.png') });

    await page.getByRole('button', { name: 'Check In' }).first().click();
    await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeVisible();

    // The inspection toggle, inside the modal — which is appended last to the
    // body through a portal.
    await page.locator('label.toggle-switch').last().click();

    // 02: the modal with the inspection toggle on.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/02-check-in-modal-inspected.png') });

    // 03: the same modal, with the racer's photo from the populated data.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/03-check-in-modal-with-photo.png') });

    await page.getByRole('button', { name: 'Save Check-in' }).click();
    await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeHidden();
    // Scoped to the roster's rows: "Checked In" also appears in the summary
    // above the table, so a bare text lookup counts the wrong things.
    const checkedInRows = page.locator('.racer-row').filter({ hasText: 'Checked In' });
    await expect(checkedInRows).toHaveCount(1);

    // The setup checklist reads the race's checked-in count, which arrives by
    // its own refetch a beat after the roster row updates — a screenshot taken
    // between the two shows "Check in cars" still undone above a row that says
    // Checked In, and whether it does depends on the machine's load that run.
    await expect(page.getByText('3 of 4 done')).toBeVisible();

    // 04: the roster with one racer checked in.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/04-racer-list-after-check-in.png') });

    // 05: a second racer checked in, so this shows *progress* rather than
    // being a second copy of 04 (#144).
    await page.getByRole('button', { name: 'Check In' }).first().click();
    await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeVisible();
    await page.locator('label.toggle-switch').last().click();
    await page.getByRole('button', { name: 'Save Check-in' }).click();
    await expect(page.getByRole('heading', { name: 'Racer Check In' })).toBeHidden();
    await expect(checkedInRows).toHaveCount(2);
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/05-check-in-progress.png') });

    // --- B. RACE CONTROL, SCHEDULE TAB ---

    await page.getByRole('link', { name: 'Control' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /Start Round Creation Wizard/i })).toBeVisible();

    // The readiness strip's Timer row says "Checking…" until the first
    // timerStatus payload lands; wait for the identified device so the
    // picture is of the settled page rather than of that first beat.
    await expect(page.getByText('Fake Timer')).toBeVisible();

    // 06: race control with no rounds yet.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/06-race-control-empty.png') });

    await page.getByRole('button', { name: /Start Round Creation Wizard/i }).click();
    await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeVisible();

    // 07: step 1, the general rounds.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/07-round-wizard-step1.png') });

    await page.getByRole('button', { name: 'Next' }).click();

    // 08: step 2, the championships.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/08-round-wizard-step2.png') });

    await page.getByRole('button', { name: 'Next' }).click();

    // 09: step 3, the review.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/09-round-wizard-step3.png') });

    // Before generating the schedule, pass everybody through inspection
    // through the API. `generate_heats_for_round` fields from
    // `car_passed_inspection`, so a roster nobody has checked in schedules
    // nothing.
    const roster = await gql<{ race: { racers: Array<{ id: number }> } }>(
        page,
        `query DocsRoster($raceId: Int!) { race(raceId: $raceId) { racers { id } } }`,
        { raceId },
    );
    for (const racer of roster.race.racers) {
        await gql(
            page,
            `mutation DocsCheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: null) { id }
            }`,
            { id: racer.id },
        );
    }

    await page.getByRole('button', { name: 'Generate Schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Race Schedule Wizard' })).toBeHidden({
        timeout: 30000,
    });
    await expect(page.locator('table').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    // 10: the schedule, with the generated heats.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/10-schedule-management.png') });

    // 11: the same view, showing the drag handles on the heat cards.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/11-heat-reordering.png') });

    // --- C. RACE CONTROL, RACE TAB: THE FIRST HEAT ---

    await page.getByRole('button', { name: 'Race', exact: true }).click();

    // The heat arms itself; "Ready to start" is the timer saying so.
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });

    // The racer and car pictures render a beat after the names: for roughly
    // the first 50ms of this view the lanes show the initials fallback, and
    // when the heat armed early enough "Ready to start" is already on screen
    // inside that window — which is how this picture kept flipping between
    // initials and photographs from run to run. Three racer portraits in the
    // lanes plus three car photos on deck is this view's settled state.
    await expect(page.locator('img[src*="/static/"]')).toHaveCount(6);

    // Collapse the fake timer panel before photographing the screen behind it.
    // Expanded, it is a floating box over the On Deck column, and this picture
    // is the one the documentation and the landing page both use to show what
    // Race Control looks like — so it was advertising a debugging aid over the
    // thing it is meant to be showing, on a track that in a real hall has a
    // real timer. Its own close-up is the next shot, which expands it again.
    await page.getByText('Fake Timer Controls').click();
    await expect(page.getByRole('button', { name: /Start Timer/i })).toBeHidden();

    // 12: the race execution view, with the lane assignments.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/12-race-execution-current-heat.png') });

    // 13: the Fake Timer Controls panel itself. It was a second copy of 12, so
    // the close-up the caption describes did not exist (#144).
    await page.getByText('Fake Timer Controls').click();
    await expect(page.getByRole('button', { name: /Start Timer/i })).toBeVisible();
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

    // Run the heat, and finish it by hand rather than waiting for the mole to
    // finish it for us. Left alone it fires `fakeTimerFinish` after
    // `3000 + Math.random() * 2000` milliseconds — a delay that exists so a
    // person clicking about has something to watch, and that this spec spent
    // twice on the critical path. The times are the same either way; they come
    // from the seeded generator, not from how long the wait was.
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 30000 });

    // The pre-flight readiness strip goes away once a heat is recorded, but
    // only when the refetch behind it lands — until then the page still says
    // "Ready to race" over a heat that has finished, and everything below it
    // sits a banner's height lower than the settled page.
    await expect(page.getByText('Ready to race')).toBeHidden();

    // 14: the finished heat, with times and placements.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/14-heat-results.png') });

    // The staging panels, shot here rather than with the other observation
    // pictures (#209). Both only exist while there is a heat after next, and
    // by the end of the race there is not — so a picture taken there can only
    // ever show one of them, and the caption beneath it would be a claim about
    // a panel that is not in it.
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

    // The live leaderboard, mid-race. Standings, not Stats: this shot is
    // captioned as the leaderboard, and clicking Stats made it a picture of
    // the lane-fairness chart (#144).
    await page.goto(`/race/${raceId}/standings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table').first()).toBeVisible();

    // 15: the standings after the first heat.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/15-live-leaderboard.png') });

    // --- D. FINISH THE QUALIFYING ROUND, THROUGH THE API ---

    const rounds = (
        await gql<{ rounds: Round[] }>(
            page,
            `query DocsRounds($raceId: Int!) {
                rounds(raceId: $raceId) { id roundNumber advancementSource }
            }`,
            { raceId },
        )
    ).rounds;
    const qualifyingRound = rounds.find((round) => round.roundNumber === 1)!;
    const championshipRound = rounds.find((round) => round.advancementSource !== null);

    const allHeats = (
        await gql<{ race: { heats: Heat[] } }>(
            page,
            `query DocsHeats($raceId: Int!) {
                race(raceId: $raceId) {
                    heats { id roundId lanes { lane racerId placeholderSlot time place skipped } }
                }
            }`,
            { raceId },
        )
    ).race.heats;

    // Every qualifying heat but the last, which is run in the browser below.
    //
    // The last one matters: `roundCompletion.ts` recovers "a round's field was
    // just decided" by comparing one query result against the previous one,
    // and `seen === null` — a fresh page — means *history*, not news. So a
    // round finished entirely behind the client's back never raises the
    // summary. That is why `16-round-completion-modal.png` was a picture of an
    // ordinary Race tab with no modal in it, over a caption on two pages
    // saying it "lists who made it, with their scores", and why this spec sat
    // for ten seconds waiting on a dialog that could not appear.
    const qualifyingHeats = allHeats.filter((heat) => heat.roundId === qualifyingRound.id);
    for (const [position, heat] of qualifyingHeats.slice(0, -1).entries()) {
        const lanes = heat.lanes;
        if (lanes.length === 0) continue; // no assignments
        if (lanes.some((lane) => lane.time !== null)) continue; // already run

        // Fake times, sorted to decide places, then put back in lane order.
        // Keyed on the heat's *position*, not its id — ids depend on how many
        // races the specs running alongside this one have created, so a spec
        // regenerated on its own would otherwise produce different times from
        // the same spec regenerated beside the others.
        const timed = lanes.map((lane, index) => ({
            ...lane,
            time: 3.0 + index * 0.13 + jitter(`${position}:${lane.lane}`),
        }));
        timed.sort((a, b) => a.time - b.time);
        const results = timed
            .map((lane, index) => ({ ...lane, place: index + 1 }))
            .sort((a, b) => a.lane - b.lane);

        await gql(
            page,
            `mutation DocsHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
                updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
            }`,
            { heatId: heat.id, lanes: results },
        );
    }

    // Those results were written straight to the backend, behind the client's
    // back, so reload before reading the screen again — otherwise the page is
    // rendering a race that finished several heats ago.
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Control' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Race', exact: true }).click();

    // The last qualifying heat, run on screen — so the client *watches* the
    // round become decided and raises the summary. See the note above.
    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();

    // 16: the summary naming the racers who made the championship round.
    // Asserted rather than hoped for: a Race tab with no modal on it
    // screenshots perfectly well, which is how the wrong picture shipped.
    const roundSummary = page.getByRole('dialog', { name: 'Round Complete!' });
    await expect(roundSummary).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/16-round-completion-modal.png') });

    await dismissRoundSummary(page);

    // --- E. THE CHAMPIONSHIP ROUND ---

    if (championshipRound) {
        await gql(
            page,
            `mutation DocsAdvance($raceId: Int!, $roundId: Int!) {
                advanceRound(raceId: $raceId, roundId: $roundId)
            }`,
            { raceId, roundId: championshipRound.id },
        );
    }

    // Same again: `advanceRound` went straight to the backend.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Control' }).click();
    await page.waitForLoadState('networkidle');

    // 17: the championship schedule.
    // Scrolled to, because the page opens at the qualifying round and the
    // championship one is below the fold — so this used to be a picture of the
    // round it is not named after (#144).
    const championshipTable = page.locator('table').last();
    await expect(championshipTable).toBeVisible();
    await championshipTable.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/17-championship-schedule.png') });

    await page.getByRole('button', { name: 'Race', exact: true }).click();

    // Filling the final's field decided a round, so the summary is up again.
    // Dismissed *before* waiting on the timer: it is modal, and leaving it
    // there while waiting means the arming is watched through a covered page.
    await dismissRoundSummary(page);

    await expect(page.getByText('Ready to start')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await page.getByRole('button', { name: 'Finish Heat' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 30000 });

    await page.goto(`/race/${raceId}/standings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table').first()).toBeVisible();
    // The Avatar column's photographs render a beat after the rows do, and the
    // fixture's image wait only covers `<img>` elements that already exist —
    // same trap as picture 12.
    await expect(page.locator('img[src*="/static/"]').first()).toBeVisible();

    // 18: the final standings.
    await page.screenshot({ path: path.join(screenshotsDir, 'race-day/18-final-standings.png') });
});
