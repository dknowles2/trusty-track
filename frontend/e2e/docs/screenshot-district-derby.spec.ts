/**
 * Screenshots of a district or council derby, for docs/district-derby.md
 * (#1076 stage 3).
 *
 * Run with:
 *   npx playwright test --config=playwright.screenshots.config.ts \
 *     e2e/docs/screenshot-district-derby.spec.ts
 *
 * Five pictures, one per section of the guide: the setup wizard's "How big
 * is it?" question (the district/council scale predates this stage, but the
 * picture does not exist yet); the roster's Home Pack column once a CSV with
 * a Pack column has been imported (#1076 stage 1); the round wizard's own
 * by-rank / each-rank prefill and its "Also give one overall trophy"
 * checkbox (this stage's own guided path); the resulting schedule, blocked
 * by rank; and the Awards page once the event has been raced to the end,
 * showing the per-rank champions and the grand-final trophy this stage
 * seeds automatically.
 *
 * `districtDerby.spec.ts` (#1076 stage 2) already proves this flow works
 * end to end through a real browser — this spec exists only to photograph
 * it, so it seeds the roster and races every heat through the API
 * (`e2e/docs/support.ts`), the same "seed through GraphQL, drive the one
 * screen under test with the browser" split every other spec in this
 * directory follows, and clicks through only the screens the guide
 * actually shows a picture of.
 */

import { test, expect, screenshotLocator } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    attemptName,
    ensureConfigured,
    gql,
    passSetupStart,
    readHeats,
    readRounds,
    recordEveryHeat,
    seedRacers,
} from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/district-derby');

const RANKS = ['Lion', 'Tiger', 'Wolf'] as const;
const HOME_UNITS: Record<(typeof RANKS)[number], string> = {
    Lion: 'Pack 12',
    Tiger: 'Pack 30',
    Wolf: 'Pack 45',
};

test('screenshot a district derby', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    await ensureConfigured(page);

    // --- 01: the setup wizard's "How big is it?" question, with the
    // district/council scale chosen. The scale itself predates this stage
    // (`context/organizationKinds.ts`); what is new is that choosing it now
    // means something further into the wizard too, which the guide explains
    // from this picture.
    //
    // Scoped to the wizard's own dialog rather than a full-page capture
    // (#1230): a full-page shot also captures Home's dimmed race list behind
    // the modal, whose row count and content depend on which other specs
    // have created races on the shared backend by this point in the run —
    // confirmed by diffing an unsharded run against a sharded one, where the
    // only pixels that moved sat in that background, never inside the
    // dialog itself. The caption is about the wizard's own question, which
    // the dialog alone already satisfies. ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Create New Race/i }).click();
    const wizardDialog = page.getByRole('dialog', { name: 'Create New Race Event' });
    await expect(wizardDialog.getByRole('heading', { name: 'Create New Race Event' })).toBeVisible();
    await passSetupStart(page);
    await page.getByRole('radio', { name: /^A district or council derby/ }).check();
    await expect(page.getByTestId('setup-words-summary')).toContainText('District');
    await screenshotLocator(wizardDialog, { path: path.join(SCREENSHOT_DIR, '01-district-scale.png') });

    // Groups step: the six ranks are pre-scaffolded under a District.
    // Tonight only three of them are racing — Bear, Webelos and Arrow of
    // Light send nobody — so they are removed here, the same "remove the
    // ones this race does not need" adjustment the step's own help text
    // suggests, rather than left to seed trophies nobody will ever win.
    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    await expect(page.getByLabel('Rank 1 name')).toHaveValue('Lion');
    for (let i = 0; i < 3; i++) {
        await page.getByTestId('setup-remove-group-3').click();
    }
    await page.getByTestId('setup-next').click();

    // Details step: the flat create form. Two trophies, so the round
    // wizard's own "N=2 default" (below) is visibly the race's real
    // configured floor, not just a coincidence of the default.
    // `Date.now()` used to be this spec's own way of dodging the collision
    // `attemptName` (#1219) now covers for the whole suite — it worked, but
    // meant every regeneration, retried or not, produced a race named
    // something new, which the roster heading below (02) renders. `attemptName`
    // keeps attempt 0's name fixed, the same as every other spec's.
    const raceName = attemptName('District Derby Screenshot');
    await expect(page.getByLabel('Event Name')).toBeVisible();
    await page.getByLabel('Event Name').fill(raceName);
    await page.getByLabel('Championship Trophies').fill('2');
    await page.getByRole('button', { name: 'Create Race' }).click();
    await page.waitForURL(/\/race\/\d+$/);
    const raceId = Number(page.url().match(/\/race\/(\d+)/)![1]);

    // --- Roster: a roster carrying home units, the way a CSV import with a
    // Pack column would leave it (#1076 stage 1) — seeded directly, since
    // this spec's picture is of the roster afterwards, not of the CSV
    // dialog `districtDerby.spec.ts` already covers. ---
    const racingGroups = await gql<{ race: { racingGroups: Array<{ id: number; name: string }> } }>(
        page,
        `query DistrictRacingGroups($raceId: Int!) {
            race(raceId: $raceId) { racingGroups { id name } }
        }`,
        { raceId },
    );
    const groupIds = Object.fromEntries(racingGroups.race.racingGroups.map((g) => [g.name, g.id]));

    let carNumber = 0;
    const carIds: Record<number, number> = {};
    for (const rank of RANKS) {
        for (let n = 0; n < 4; n++) {
            carNumber += 1;
            const ids = await seedRacers(
                page,
                raceId,
                [
                    {
                        first: `${rank}${n + 1}`,
                        last: HOME_UNITS[rank],
                        car: carNumber,
                        carName: `${rank} Racer`,
                        racingGroup: rank,
                        homeUnit: HOME_UNITS[rank],
                    },
                ],
                groupIds,
            );
            carIds[carNumber] = ids[carNumber];
        }
    }

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Home Pack').first()).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-roster-home-pack.png') });

    // --- Round wizard: opened on a race with no rounds yet, whose words are
    // the district scale — the prefill this stage adds. Step 2 is where
    // both halves of it show at once: "Each Rank" already selected, and
    // "Also give one overall trophy" already checked. ---
    await page.goto(`/race/${raceId}/control/schedule`);
    await page.getByRole('button', { name: 'Start Round Creation Wizard' }).click();
    await expect(page.getByLabel(/By Rank/)).toBeChecked();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('select')).toHaveValue('EACH_GROUP');
    await expect(page.getByLabel(/Also give one overall trophy/)).toBeChecked();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-round-wizard-prefill.png') });

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Generate schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Lion' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Tiger' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wolf' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grand Finals' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-schedule-by-rank.png') });

    // --- Race every heat through the API — recording is not the step under
    // test, and driving each one by hand through the timer UI would make a
    // schedule bug anywhere look like a failure of this spec. Lion's cars
    // run fastest, Tiger's next, Wolf's slowest, so the grand final and
    // every rank's own standings resolve to a clean, deterministic podium
    // rather than whatever a random time would happen to produce. ---
    const timeOf = new Map<number, number>();
    for (const [car, racerId] of Object.entries(carIds)) {
        const n = Number(car);
        const rankIndex = Math.floor((n - 1) / 4);
        timeOf.set(racerId, 3.0 + rankIndex * 0.3 + (n % 4) * 0.05);
    }

    const rounds = await readRounds(page, raceId);
    const qualifyingRoundIds = new Set(rounds.filter((r) => r.advancementSource === null).map((r) => r.id));
    const finalRound = rounds.find((r) => r.advancementSource !== null)!;

    const qualifyingHeats = (await readHeats(page, raceId)).filter(
        (h) => h.roundId !== null && qualifyingRoundIds.has(h.roundId),
    );
    await recordEveryHeat(page, qualifyingHeats, timeOf);

    await gql(
        page,
        `mutation AdvanceDistrictFinal($raceId: Int!, $roundId: Int!) {
            advanceRound(raceId: $raceId, roundId: $roundId)
        }`,
        { raceId, roundId: finalRound.id },
    );
    const finalHeats = (await readHeats(page, raceId)).filter((h) => h.roundId === finalRound.id);
    await recordEveryHeat(page, finalHeats, timeOf);

    // --- Awards: the per-rank champions and the grand-final trophy, both
    // seeded automatically the moment the round wizard's schedule was
    // generated — no "Add an award" step, which is the whole point of this
    // stage's checkbox. ---
    await page.goto(`/race/${raceId}/awards`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Not decided by the racing yet')).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-awards.png') });
});
