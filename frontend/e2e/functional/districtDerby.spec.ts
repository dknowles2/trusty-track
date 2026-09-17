/**
 * The district-derby flow, end to end (#1076, stages 2 and 3).
 *
 * `test_format_crossings.py::test_district_derby_crossing` already proves the
 * backend composition — ranks as racing groups, one qualifying round per
 * rank, a combined grand final, awards resolving against `services.scoring`,
 * the roll-down settling a double winner — against the GraphQL client
 * directly. What only a real browser shows is that the same event can be
 * *built* by an operator, and — since stage 3 — built the *short* way: the
 * race setup wizard's existing "A district or council derby" scale
 * (`context/organizationKinds.ts`, predates #1076 — ranks and the
 * District/Rank words), a roster imported from a CSV with a Pack column
 * (`Racer.home_unit`, stage 1), the round wizard opening pre-filled for "By
 * Rank" qualifying and an "Each Rank" grand final with "Also give one
 * overall trophy" already ticked (`ScheduleManagement.tsx`'s
 * `isDistrictWords` prefill, stage 3 — the organiser no longer chooses any
 * of that by hand), and the Awards page reading it all back — a rank's own
 * champion named with their home unit, a grand-final trophy seeded
 * automatically rather than added by hand, and (once
 * `Race.oneTrophyPerRacer` is on) the roll-down note explaining why a
 * double winner's rank trophy moved.
 *
 * A flow test, not a layout one — `scrollWidth` is checked once, at 1280,
 * as a sanity check rather than a mobile-width audit (those live in
 * `mobile*.spec.ts`).
 */

import { test, expect } from '@playwright/test';
import {
    ensureConfigured,
    gql,
    openSetupWizardAtKind,
    readHeats,
    readRounds,
    recordRound,
    type SeededRacer,
} from './support';

const RANKS = ['Lion', 'Tiger', 'Wolf'] as const;
const RACERS_PER_RANK = 5;
const HOME_UNITS = ['Pack 12', 'Pack 30', 'Pack 45'];

test('a district derby is built through the wizard, the roster, the round wizard and the Awards page', async ({
    page,
}) => {
    await ensureConfigured(page);

    // --- Race setup wizard: Cub Scouts' existing "district or council
    // derby" scale, which already scaffolds six ranks under a District
    // (predates #1076; stage 1's `home_unit` and stage 2's round-wizard
    // composition are what is new here). ---
    await page.goto('/');

    // Other specs share this backend and may already have a race, in which
    // case the wizard opens on a scratch-or-copy choice first — scratch is
    // the default, matching `raceSetupWizard.spec.ts`'s own handling.
    // `openSetupWizardAtKind` waits for whichever step shows before deciding
    // whether to step past it (#1199).
    await openSetupWizardAtKind(page);
    await page.getByRole('radio', { name: /^A district or council derby/ }).check();
    await page.getByTestId('setup-next').click();

    // Groups step: the six ranks are pre-scaffolded ("Rank 1 name" etc.) —
    // only three (Lion, Tiger, Wolf) get racers below, and the qualifying
    // wizard skips a rank with nobody checked in, so the other three never
    // become rounds.
    await expect(page.getByTestId('setup-step-groups')).toBeVisible();
    await expect(page.getByLabel('Rank 1 name')).toHaveValue('Lion');
    await page.getByTestId('setup-next').click();

    const raceName = `District Derby Flow ${Date.now()}`;
    await expect(page.getByLabel('Event Name')).toBeVisible();
    await page.getByLabel('Event Name').fill(raceName);
    await page.getByRole('button', { name: 'Create Race' }).click();

    await page.waitForURL(/\/race\/\d+$/);
    const raceId = Number(page.url().match(/\/race\/(\d+)/)![1]);

    // --- Roster: a CSV with a Pack column, the way a district's roster
    // actually arrives (#1076's "a dozen packs send their qualifiers") —
    // three ranks of five racers apiece, each carrying a home unit. No car
    // number column: `PER_GROUP` numbering (the wizard's own default once
    // groups exist) assigns each rank its own block in file order, which is
    // what makes Lion's block the lowest-numbered and so, under
    // `recordRound`'s car-number-orders-time rule below, the rank that
    // produces the grand-final's overall winner — the double winner the
    // roll-down assertion at the end needs, without hand-rigging any result.
    const rows = ['first_name,last_name,racing_group,home_unit'];
    RANKS.forEach((rank, rankIdx) => {
        for (let n = 0; n < RACERS_PER_RANK; n++) {
            const homeUnit = HOME_UNITS[(rankIdx * RACERS_PER_RANK + n) % HOME_UNITS.length];
            rows.push(`${rank}${n},District,${rank},${homeUnit}`);
        }
    });
    const csvFile = {
        name: 'district-roster.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(rows.join('\n') + '\n'),
    };

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'More ways to add racers' }).click();
    await page.getByRole('button', { name: 'Import from CSV' }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import Racers from CSV' });
    await expect(importDialog).toBeVisible();

    await page.locator('#csv-upload-input').setInputFiles(csvFile);
    await expect(page.getByText('Match your columns')).toBeVisible();
    const totalRacers = RANKS.length * RACERS_PER_RANK;
    await page.getByRole('button', { name: new RegExp(`Import ${totalRacers} Racers`) }).click();
    await expect(page.getByText(`Imported ${totalRacers} racers.`)).toBeVisible();

    // Check-in through GraphQL — not the step under test, and the CSV
    // importer carries no "passed inspection" column of its own.
    const roster = await gql<{ race: { racers: SeededRacer[] } }>(
        page,
        `query ReadDistrictRoster($raceId: Int!) {
            race(raceId: $raceId) { racers { id firstName lastName carNumber } }
        }`,
        { raceId },
    );
    const racers = roster.race.racers;
    await gql(
        page,
        `mutation CheckInDistrictRoster($racerIds: [Int!]!) {
            bulkCheckIn(racerIds: $racerIds, passedInspection: true)
        }`,
        { racerIds: racers.map((r) => r.id) },
    );

    // --- Round wizard: opened on a race with no rounds yet, whose words
    // are the district scale chosen above — the short path #1076 stage 3
    // adds. It no longer needs to be told "By Rank" qualifying and an
    // "Each Rank" grand final (`crud.create_general_round`'s `EACH_GROUP`
    // type for qualifying, `EACH_GROUP` advancement for the grand final,
    // #1076's own "What already fits" table); it opens on both already,
    // with "Also give one overall trophy" already ticked too — accepting
    // the prefill is the whole of this step now. ---
    await page.goto(`/race/${raceId}/control/schedule`);
    await page.getByRole('button', { name: 'Start Round Creation Wizard' }).click();

    await expect(page.getByLabel(/By Rank/)).toBeChecked();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: one championship round ("Grand Finals") is pre-populated,
    // already "Each Rank" with "Also give one overall trophy" checked, and
    // "Number to pick" prefilled at 3 (`championshipTrophies`'s own
    // default). Raised to 4 here — one more than the trophy count — so
    // that once the overall trophy claims the three fastest Lions (Lion's
    // car numbers are always the race's lowest, so Lion sweeps the top of
    // any combined field under this spec's deterministic times), a fourth
    // Lion is still in the final and still eligible for Lion's *own*
    // "Fastest in Lion" award once the roll-down below runs — the
    // runner-up the roll-down assertion checks for. With only 3 Lions in
    // the final, all three would already hold the overall trophy and
    // Lion's own award would have nobody left to roll down to, which is a
    // correct answer to a different question than the one this spec means
    // to ask.
    await expect(page.locator('select')).toHaveValue('EACH_GROUP');
    await expect(page.getByLabel(/Also give one overall trophy/)).toBeChecked();
    const numberToPick = page.locator('xpath=//label[text()="Number to pick"]/following-sibling::input');
    await expect(numberToPick).toHaveValue('3');
    await numberToPick.fill('4');
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByRole('button', { name: 'Generate schedule' }).click();
    await expect(page.getByRole('heading', { name: 'Lion' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Tiger' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wolf' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grand Finals' })).toBeVisible();

    // --- Race every heat, through `support.ts`'s own helper, the way
    // `raceDay.spec.ts` does — recording is not the step under test either,
    // and driving each heat by hand through the timer UI would make a
    // schedule bug anywhere look like a failure of this spec. ---
    const rounds = await readRounds(page, raceId);
    const qualifyingRoundIds = new Set(rounds.filter((r) => r.advancementSource === null).map((r) => r.id));
    expect(qualifyingRoundIds.size).toBe(RANKS.length);
    const finalRound = rounds.find((r) => r.advancementSource !== null)!;

    const qualifyingHeats = (await readHeats(page, raceId)).filter((h) =>
        h.roundId !== null && qualifyingRoundIds.has(h.roundId),
    );
    await recordRound(page, qualifyingHeats, racers);

    // The grand final's placeholders are only filled once every qualifying
    // round is decided — re-read after recording them, the same two-pass
    // shape `championshipAwardSeed.spec.ts` uses.
    const finalHeats = (await readHeats(page, raceId)).filter((h) => h.roundId === finalRound.id);
    await recordRound(page, finalHeats, racers);

    // --- Awards: the wizard's own championship-trophy seeding (#1082,
    // extended by #1076 stage 3's "Also give one overall trophy") has
    // already created one "1st Place"/"2nd/3rd" set per rank, scoped to the
    // grand final round (`EACH_GROUP` advancement seeds per group) — this
    // event's "rank champion" set — *and* one more, unscoped, set for
    // whoever is fastest across the grand final as a whole. No "Add an
    // award" step: accepting the checkbox above is what seeds it. ---
    await page.goto(`/race/${raceId}/awards`);

    // Scoped to `.award-row-desc`, not the whole `<li>` — its description
    // ("Fastest in Grand Finals") is what distinguishes it from a rank's own
    // "1st Place" row, which reads "Fastest in Lion" instead.
    const grandFinalRow = page
        .locator('li')
        .filter({ has: page.locator('.award-row-desc', { hasText: 'Fastest in Grand Finals' }) });
    await expect(grandFinalRow).toBeVisible();
    await expect(grandFinalRow.getByText('Not decided by the racing yet')).toHaveCount(0);
    const grandFinalWinner = (await grandFinalRow.locator('.award-row-recipient span').first().textContent())!;

    // A rank champion, named with their home unit — stage 1's `awardText.ts`
    // (`racerLabel`'s "Name (#n) · Pack"), read off a real, raced result.
    const lionRow = page
        .locator('li')
        .filter({ has: page.locator('.award-row-desc', { hasText: 'Fastest in Lion' }) });
    await expect(lionRow).toBeVisible();
    await expect(lionRow.locator('.award-row-recipient')).toContainText('·');

    // The double winner: `RANKS`' file order and `PER_GROUP` numbering give
    // Lion the lowest car numbers in the race, so the grand final's overall
    // fastest car is a Lion — the same racer `describeSpeedAward` names for
    // both "Fastest in Grand Finals" and "Fastest in Lion" before the
    // roll-down is switched on.
    await expect(lionRow.locator('.award-row-recipient')).toContainText(grandFinalWinner.split(' · ')[0]);

    // --- The roll-down: "at most one trophy per racer" (`domain/roll_down.py`).
    // Toggled through GraphQL — the checkbox itself
    // (`RaceForm`'s "At most one trophy per racer") is exercised elsewhere;
    // what this spec proves is that a district event's own awards read the
    // rolled-down result correctly once it is on. ---
    await gql(
        page,
        `mutation TurnOnDistrictRollDown($id: Int!, $race: RaceUpdateInput!) {
            updateRace(id: $id, race: $race) { id }
        }`,
        { id: raceId, race: { oneTrophyPerRacer: true } },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');

    const lionRowAfter = page
        .locator('li')
        .filter({ has: page.locator('.award-row-desc', { hasText: 'Fastest in Lion' }) });
    await expect(lionRowAfter).toContainText('Rolled down from Fastest');
    // Not asserted by name here: the passed-over award's own note names it
    // by its stored `name` (`awardText.rollDownNote`), and the auto-seeded
    // overall trophy shares the generic "1st Place" name every rank's own
    // does — distinguishing them is what `.award-row-desc` is for, not the
    // note text. The recipient check below is the specific assertion.
    //
    // The recipient moved off the double winner, onto the rank's own
    // runner-up.
    const lionRecipientAfter = (
        await lionRowAfter.locator('.award-row-recipient span').first().textContent()
    )!;
    expect(lionRecipientAfter).not.toBe(grandFinalWinner);

    // The grand final itself is unaffected — the race-wide podium is
    // resolved first (`roll_down.priority_order`), so it keeps its winner.
    const grandFinalRowAfter = page
        .locator('li')
        .filter({ has: page.locator('.award-row-desc', { hasText: 'Fastest in Grand Finals' }) });
    await expect(grandFinalRowAfter.locator('.award-row-recipient span').first()).toHaveText(grandFinalWinner);

    // A flow test, not a layout test — one sanity check, at 1280, that the
    // Awards page (nine seeded rank trophies plus three auto-seeded overall
    // ones — `championshipTrophies` defaults to 3) does not overflow.
    await page.setViewportSize({ width: 1280, height: 900 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1282);
});
