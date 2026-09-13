/**
 * The "Import from other racing software" menu entry, end to end (#1086).
 *
 * The GPRM and DerbyNet importers used to be two menu entries, each opening
 * its own mount of `RosterImportModal` with `source` already pinned. They
 * are now one entry, and `RosterImportModal.test.tsx` already covers the
 * chooser step's own behaviour (one option per source, Continue, Back) as a
 * component test. What that cannot see is the whole stack agreeing: the menu
 * really does say "Import from other racing software" now, and picking
 * DerbyNet from the chooser really does call `previewDerbynetImport` against
 * a real backend and render what it finds.
 *
 * The fixture is a real SQLite file, built with `node:sqlite` rather than
 * checked in as a binary — `backend/tests/roster_imports/derbynet.sql`'s own
 * `ONE_RACER_SCRIPT` sibling in `test_derbynet_import_mutation.py` is the
 * minimal shape the parser accepts (a `RegistrationInfo` table; `ClassID`/
 * `RankID` may be null), reproduced here so this spec does not need a
 * fixture file living outside `frontend/`.
 *
 * Run with:
 *   cd frontend && npm run test:e2e -- rosterImportChooser
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { ensureConfigured, gql } from './support';

// `DatabaseSync` has no in-memory `serialize()` on the Node version this
// runs against, so the fixture is built on disk (a uniquely-named temp file,
// since specs may run in parallel) and read back as bytes.
function derbynetFixtureBytes(): Buffer {
    const dbPath = path.join(os.tmpdir(), `derbynet-fixture-${process.pid}-${Date.now()}.sqlite`);
    const db = new DatabaseSync(dbPath);
    try {
        db.exec(`
            CREATE TABLE RegistrationInfo (
                RacerID INTEGER, CarNumber INTEGER, CarName TEXT,
                LastName TEXT, FirstName TEXT, ClassID INTEGER, RankID INTEGER,
                PassedInspection INTEGER
            );
            INSERT INTO RegistrationInfo VALUES
                (1, 101, 'Blue Streak', 'Rivera', 'Alex', NULL, NULL, -1);
        `);
    } finally {
        db.close();
    }
    const bytes = fs.readFileSync(dbPath);
    fs.unlinkSync(dbPath);
    return bytes;
}

test('imports a roster from DerbyNet through the merged menu entry', async ({ page }) => {
    await ensureConfigured(page);

    const config = await gql<{ organizations: { id: number }[]; tracks: { id: number }[] }>(
        page,
        `query { organizations { id } tracks { id } }`,
    );
    const race = await gql<{ createRace: { id: number } }>(
        page,
        `mutation Create($race: RaceInput!) { createRace(race: $race) { id } }`,
        {
            race: {
                name: 'Roster Import Chooser',
                organizationId: config.organizations[0].id,
                trackId: config.tracks[0].id,
                carNumberingStrategy: 'MANUAL',
            },
        },
    );
    const raceId = race.createRace.id;

    await page.goto(`/race/${raceId}`);

    // The menu: one entry, not two, and it names no program by itself.
    await page.getByRole('button', { name: 'More ways to add racers' }).click();
    await expect(page.getByRole('button', { name: 'Import from GrandPrix Race Manager' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import from DerbyNet' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Import from other racing software' }).click();

    // The chooser step.
    await expect(page.getByRole('dialog', { name: 'Import from other racing software' })).toBeVisible();
    await page.getByRole('radio', { name: /DerbyNet/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // The file step, now scoped to DerbyNet's own config.
    await expect(page.getByRole('dialog', { name: 'Import from DerbyNet' })).toBeVisible();
    await expect(page.getByText('Select DerbyNet Database')).toBeVisible();

    const fixture = {
        name: 'derbynet.sqlite',
        mimeType: 'application/octet-stream',
        buffer: derbynetFixtureBytes(),
    };
    await page.locator('#derbynet-upload-input').setInputFiles(fixture);

    // The preview: a real round trip through `previewDerbynetImport`.
    await expect(page.getByText('Alex Rivera')).toBeVisible();
    await expect(page.getByRole('button', { name: /Import 1 Racer/ })).toBeEnabled();

    // Back returns to the chooser and drops the file rather than carrying
    // it to whichever source is picked next.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('dialog', { name: 'Import from other racing software' })).toBeVisible();
    await page.getByRole('radio', { name: /DerbyNet/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Alex Rivera')).toHaveCount(0);

    // Finish the import this time.
    await page.locator('#derbynet-upload-input').setInputFiles(fixture);
    await expect(page.getByText('Alex Rivera')).toBeVisible();
    await page.getByRole('button', { name: /Import 1 Racer/ }).click();
    await expect(page.getByText('Imported 1 racer.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Alex', { exact: true })).toBeVisible();
});
