/**
 * A racer's home pack (#1076, stage 1) — the district-derby ground floor:
 * `Racer.home_unit`, free text, distinct from `racing_group_id` (the rank).
 *
 * Every unit test in this stage's own files (`RacerForm.test.tsx`,
 * `rosterSort.test.ts`, `awardText.test.ts`, `PitPass.test.tsx`,
 * `standingsExport.test.ts`, `csvMapping.test.ts`) already pins the rule in
 * isolation. What only a real backend and a real browser show is that the
 * field survives the trip: typed into the form, read back on the roster at
 * both a desktop and a phone width, printed onto a pit pass, named in an
 * award's recipient line once a result decides it, and mapped in from a CSV
 * column that is not the canonical `home_unit` header.
 */

import { test, expect } from '@playwright/test';
import {
    createSchedule,
    ensureConfigured,
    gql,
    readHeats,
    readRounds,
    recordRound,
    seedRace,
} from './support';

test('added through the form, a home unit shows on the roster at desktop and phone widths', async ({
    page,
}) => {
    const { raceId } = await seedRace(page, 'Home Unit Roster ' + Date.now());
    await ensureConfigured(page);
    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add Racer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add New Racer' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('First Name').fill('Jordan');
    await dialog.getByLabel('Last Name').fill('Mitchell');
    await dialog.getByLabel('Home Pack').fill('Pack 12');
    await dialog.getByRole('button', { name: 'Save Racer' }).click();
    await expect(dialog).toBeHidden();

    // Desktop: a dedicated, sortable column — present only because this
    // race now has a racer carrying a value (#1076: no column at all for an
    // ordinary single-pack race).
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopRow = page.locator('.racer-row:visible').filter({ hasText: 'Jordan' });
    await expect(desktopRow).toContainText('Pack 12');

    // Phone: folded into the one-line `Name · #n · {group} · {unit}` row
    // #1148 already gives every racer card, rather than a column of its own.
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneRow = page.locator('.racer-card:visible').filter({ hasText: 'Jordan' });
    await expect(phoneRow).toContainText('Pack 12');
});

test('a home unit prints as a small line on the pit pass', async ({ page }) => {
    const { raceId, racers } = await seedRace(page, 'Home Unit Pit Pass ' + Date.now());
    await ensureConfigured(page);

    const racer = racers[0];
    await gql(
        page,
        `mutation SetHomeUnitForPitPass($id: Int!, $racer: RacerInput!) {
            updateRacer(id: $id, racer: $racer) { id }
        }`,
        {
            id: racer.id,
            racer: {
                firstName: racer.firstName,
                lastName: racer.lastName,
                // `carPassedInspection` has no way to stay "unset" on
                // `RacerInput` — a plain `bool`, not `bool | None` — so
                // leaving it out of this payload would silently uncheck a
                // racer `seedRace` already checked in (#747's own trap,
                // one field over). Harmless here, but worth being correct
                // about rather than relying on it not mattering.
                carPassedInspection: true,
                homeUnit: 'Pack 12',
            },
        },
    );

    await page.goto(`/race/${raceId}/print?kind=pit-pass&racers=${racer.id}`);
    await expect(page.getByTestId(`pit-pass-${racer.id}`)).toContainText('Pack 12');
});

test("an award's recipient line names the winner's home unit once a result decides it", async ({
    page,
}) => {
    const { raceId, racers } = await seedRace(page, 'Home Unit Award ' + Date.now());
    await ensureConfigured(page);

    // Car 1 (Ada Ant) is the fastest under `recordRound`'s car-number-orders-
    // time rule (support.ts), so give that racer a unit to look for once the
    // Pack Champion award resolves.
    const winner = racers.find((r) => r.carNumber === 1)!;
    await gql(
        page,
        `mutation SetHomeUnitForAward($id: Int!, $racer: RacerInput!) {
            updateRacer(id: $id, racer: $racer) { id }
        }`,
        {
            id: winner.id,
            racer: {
                firstName: winner.firstName,
                lastName: winner.lastName,
                // See the identical comment above — `carPassedInspection`
                // must be restated or this un-checks a racer `seedRace`
                // already checked in, silently dropping them from
                // advancement (#747).
                carPassedInspection: true,
                homeUnit: 'Pack 12',
            },
        },
    );

    await createSchedule(page, raceId, { name: 'Grand Finals', numTopRacers: 3 });
    const rounds = await readRounds(page, raceId);
    const generalRound = rounds.find((r) => r.advancementSource === null)!;
    const finalRound = rounds.find((r) => r.advancementSource !== null)!;

    const generalHeats = (await readHeats(page, raceId)).filter((h) => h.roundId === generalRound.id);
    await recordRound(page, generalHeats, racers);
    const finalHeats = (await readHeats(page, raceId)).filter((h) => h.roundId === finalRound.id);
    await recordRound(page, finalHeats, racers);

    await gql(
        page,
        `mutation SeedTrophy($raceId: Int!) { seedChampionshipAwards(raceId: $raceId) { id } }`,
        { raceId },
    );

    await page.goto(`/race/${raceId}/awards`);
    const firstRow = page.locator('li').filter({ hasText: '1st Place' });
    await expect(firstRow).toContainText('Ada Ant (#1) · Pack 12');
});

test('a CSV column that is not the canonical header maps to a home unit on import', async ({
    page,
}) => {
    await ensureConfigured(page);

    const config = await gql<{ organizations: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { organizations { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation CreateHomeUnitCsvRace($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Home Unit CSV Import ' + Date.now(),
                organizationId: config.organizations[0].id,
                trackId: config.tracks[0].id,
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    await page.goto(`/race/${raceId}`);
    await page.waitForLoadState('networkidle');

    // "Home Pack" rather than the canonical "home_unit" — a plausible
    // district-spreadsheet header. Deliberately not the bare word "Pack":
    // `csvMapping.ts`'s own `HINTS` give that single word to `racingGroup`
    // first (a pack-derby CSV genuinely uses "Pack" to mean the den), and
    // `homeUnit`'s own hints ("homeunit", "homepack", "troop") are the more
    // specific phrases that win before that ambiguous one is ever reached —
    // see the comment beside `HINTS.homeUnit` for the full reasoning.
    const csv = 'first_name,last_name,Home Pack\nTaylor,Nguyen,Pack 30\n';
    const csvFile = { name: 'district-roster.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };

    await page.getByRole('button', { name: 'More ways to add racers' }).click();
    await page.getByRole('button', { name: 'Import from CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Racers from CSV' });
    await expect(dialog).toBeVisible();

    await page.locator('#csv-upload-input').setInputFiles(csvFile);
    await expect(page.getByText('Match your columns')).toBeVisible();

    // `guessMapping` claims the "Home Pack" column for `homeUnit` on its
    // own — no dropdown to change here confirms the mapping the brief asked
    // for, and the preview table is the same client-side proof
    // `roster.spec.ts` already leans on for the other fields.
    await expect(page.getByLabel('Home Pack')).toHaveValue('Home Pack');
    await expect(page.getByRole('cell', { name: 'Pack 30' })).toBeVisible();

    await page.getByRole('button', { name: /Import 1 Racers/ }).click();
    await expect(page.getByText('Imported 1 racers.')).toBeVisible();

    const written = await gql<{ race: { racers: { firstName: string; homeUnit: string | null }[] } }>(
        page,
        `query ReadImportedHomeUnit($raceId: Int!) {
            race(raceId: $raceId) { racers { firstName homeUnit } }
        }`,
        { raceId },
    );
    expect(written.race.racers.find((r) => r.firstName === 'Taylor')?.homeUnit).toBe('Pack 30');
});
