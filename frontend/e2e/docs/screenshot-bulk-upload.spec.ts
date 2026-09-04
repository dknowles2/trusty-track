/**
 * Playwright spec to capture screenshots of the Bulk Photo Upload modal
 * for docs/race-day.md.
 *
 * Run with:
 *   npx playwright test e2e/docs/screenshot-bulk-upload.spec.ts --headed
 *
 * Assumes the Vite dev server is running at http://localhost:5173 and the
 * backend is reachable (the Vite proxy handles the SSL tunnel to port 8005).
 */

import { test, expect } from './screenshots-setup';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';
import { BACKEND_URL, ensureConfigured, skipToRaceForm } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/assets/screenshots/race-day');

// A tiny PNG encoder for a solid-colour square (#606). The modal previews
// straight from the picked file's own bytes (`PhotoPreview` in
// `BulkPhotoUploadModal.tsx` uses `URL.createObjectURL`, never the server's
// answer), so three copies of the same placeholder JPEG rendered as three
// identical black thumbnails — a real, if minimal, image was still the wrong
// picture for a page whose whole subject is photographs. No image library is
// needed for a single-colour square: a 4-byte CRC table and one `zlib.deflateSync`
// call over the raw scanlines is the whole of the PNG format that matters here.
function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buf) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function solidColorPng(size: number, [r, g, b]: [number, number, number]): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); // width
    ihdr.writeUInt32BE(size, 4); // height
    ihdr.writeUInt8(8, 8); // bit depth
    ihdr.writeUInt8(2, 9); // colour type: truecolour (RGB)
    ihdr.writeUInt8(0, 10); // compression
    ihdr.writeUInt8(0, 11); // filter
    ihdr.writeUInt8(0, 12); // interlace
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
    const raw = Buffer.concat(Array(size).fill(row));
    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

// Three distinct colours, so the three sample photos are visibly different in
// the docs rather than three copies of the same thumbnail.
const SAMPLE_PHOTOS: Array<{ name: string; color: [number, number, number] }> = [
    { name: 'racer-01.png', color: [198, 40, 40] }, // red
    { name: 'racer-02.png', color: [21, 101, 192] }, // blue
    { name: 'racer-03.png', color: [46, 125, 50] }, // green
];

test('screenshot bulk photo upload modal', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 880 });

    // Intercept uploadImage GraphQL mutation — return a stable fake URL so
    // uploads complete instantly without writing to disk.
    //
    // Every branch has to end in `fulfill` or `continue`, including the one
    // where something goes wrong: this handler sits in front of *every*
    // GraphQL call the page makes, and `postDataJSON()` throws rather than
    // returning null on a body it cannot parse, so one throw in here would
    // leave that request dangling for ever.
    let uploadCallCount = 0;
    await page.route('**/graphql', async (route) => {
        let query: string | undefined;
        try {
            query = (route.request().postDataJSON() as { query?: string } | null)?.query;
        } catch {
            query = undefined;
        }
        if (query?.includes('uploadImage') || query?.includes('UploadImage')) {
            uploadCallCount++;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { uploadImage: `/static/demo-racer-${uploadCallCount}.jpg` },
                }),
            });
            return;
        }
        await route.continue();
    });

        // ── Navigate to Home and create a race first ───────────────────────────
        await ensureConfigured(page);

        await page.getByRole('button', { name: /Create New Race/i }).click();
    // Through the setup wizard (#662) on its default answers to the form.
    await skipToRaceForm(page);
    await page.getByPlaceholder('e.g. 2024 Pinewood Derby').fill('Bulk Upload Race');
    await page.getByRole('button', { name: 'Create Race' }).click();
    // Creating a race opens it; this used to have to click through from Home.
    await page.waitForURL('**/race/*');
    await page.waitForTimeout(600);

    // Populate test data so we have racers
    await page.locator('.split-btn-arrow').click();
    await page.getByText(/Populate Test Data/i).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForResponse(response => response.url().includes('graphql') && response.status() === 200, { timeout: 30000 });
    await page.waitForTimeout(1000);

    // The names to type into the combobox, read off the roster that was just
    // generated rather than guessed. `populateRace` invents its racers, so the
    // fragments this spec used to hard-code ("jax", "ozz") matched nobody —
    // and the two screenshots below were captioned as a filtered list and an
    // assigned photo while showing "No matches" and "0 of 3" (#144).
    const raceId = Number(page.url().match(/\/race\/(\d+)/)![1]);
    const rosterResponse = await page.request.post(`${BACKEND_URL}/graphql`, {
        data: JSON.stringify({
            query: `query { race(raceId: ${raceId}) { racers { firstName lastName } } }`,
        }),
        headers: { 'Content-Type': 'application/json' },
    });
    const roster = (await rosterResponse.json()).data.race.racers as {
        firstName: string;
        lastName: string;
    }[];
    // A first name, which is what an operator would start typing. Distinct
    // ones, so the second assignment cannot land on the first racer.
    const [firstRacer, secondRacer] = roster.filter(
        (r, i, all) => all.findIndex((o) => o.firstName === r.firstName) === i,
    );

    // ── Screenshot 1: the toolbar, with the overflow open on Upload Photos ──
    // Scroll to top so the toolbar is visible
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    // Upload Photos moved behind the overflow in #186 — it is a set-up action,
    // not one reached for during an event — so the picture of "where the button
    // is" has to show the menu open.
    await page.getByTestId('roster-more-menu').click();
    await page.waitForTimeout(300);
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '19-upload-photos-button.png'),
    });

    // ── Open the modal ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /upload photos/i }).click();
    await page.waitForTimeout(500);

    // ── Screenshot 2: empty modal ───────────────────────────────────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '20-bulk-upload-modal-empty.png'),
    });

    // ── Inject 3 test image files into the hidden file input ────────────────
    const tmpDir = path.resolve(__dirname, '../.playwright-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    // Three distinct images (#606) — this spec is illustrating the modal, not
    // guarding #116, so byte-identical files (which used to be the point:
    // three `uploadImage` mutations with the same data URL are one urql
    // operation, and only one of them ever came back) are not needed here.
    // That regression is pinned against a real mocked client in
    // `BulkPhotoUploadModal.test.tsx` ("uploads an image picked twice only
    // once, and finishes both" / "gives both copies the same uploaded
    // image"), independent of this spec. Distinct files still exercise "one
    // request per distinct image" — each is its own `uploadImage` call below.
    const filePaths = SAMPLE_PHOTOS.map(({ name, color }) => {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, solidColorPng(80, color));
        return p;
    });

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(filePaths);

    // Wait for all 3 upload intercepts to fire and state to settle
    await page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input[placeholder="— Assign to racer —"]');
        return inputs.length >= 3;
    }, { timeout: 10000 });
    await page.waitForTimeout(400);

    // ── Screenshot 3: modal with 3 loaded photos (unassigned) ──────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '21-bulk-upload-photos-loaded.png'),
    });

    // ── Open the first combobox (focus shows full racer list) ───────────────
    // Wait for the dropdown's own settled content rather than a fixed sleep,
    // per the docs' "wait for the settled content, not just an element" rule.
    // #606 asked whether the bare-text rows were an avatar-loading race, the
    // same shape as the readiness-strip and roster-count races that rule was
    // written for — they were not, at the time: this modal held a second,
    // avatar-less combobox rather than the shared `RacerCombobox.tsx` Free
    // Race already used. #693 replaced it with the shared one, so the rows
    // now do carry a portrait (or an initials roundel where a racer has none)
    // — real ones here, since `populateRace` assigns racer photos by default.
    // The `page.screenshot` override in `screenshots-setup.ts` already waits
    // for every `<img>` on the page to finish loading before it snapshots, so
    // that race is covered there rather than needing a second wait here; this
    // still waits for every racer's own row to exist first, which is the
    // actual thing the caption is showing ("full racer list"). The shared
    // combobox also prepends an "— Empty —" row for clearing an assignment,
    // which this modal's own combobox never offered — one more racer's worth
    // of rows than before.
    const firstCombobox = page.locator('input[placeholder="— Assign to racer —"]').first();
    await firstCombobox.click();
    const firstDropdown = firstCombobox.locator('xpath=following-sibling::ul');
    await expect(firstDropdown.locator('li')).toHaveCount(roster.length + 1);

    // ── Screenshot 4: combobox open, showing full racer list ────────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '22-bulk-upload-combobox-open.png'),
    });

    // Type to filter, with a name that is actually on this roster.
    await firstCombobox.fill(firstRacer.firstName);
    await page.waitForTimeout(250);

    // ── Screenshot 5: combobox filtered to matching racer ───────────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '23-bulk-upload-combobox-filtered.png'),
    });

    // Highlight the first match, then take it. `Enter` alone only commits when
    // exactly one racer matches (`handleKeyDown` in `BulkPhotoUploadModal`), and
    // a first name usually matches several — which is why this spec used to end
    // with nothing assigned.
    await firstCombobox.press('ArrowDown');
    await firstCombobox.press('Enter');
    await page.waitForTimeout(300);

    // Assign a second photo
    const secondCombobox = page.locator('input[placeholder="— Assign to racer —"]').nth(1);
    await secondCombobox.click();
    await secondCombobox.fill(secondRacer.firstName);
    await page.waitForTimeout(250);
    await secondCombobox.press('ArrowDown');
    await secondCombobox.press('Enter');
    await page.waitForTimeout(300);

    // ── Screenshot 6: modal with 2 photos assigned, Apply button active ─────
    // The caption's claims: two of the three uploaded photos are assigned,
    // and Apply is enabled rather than greyed out.
    await expect(page.getByText('2 of 3 uploaded photo(s) assigned')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Apply 2 Assignment/ })).toBeEnabled();
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '24-bulk-upload-assigned.png'),
    });

    // Cleanup tmp files
    filePaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
    try { fs.rmdirSync(tmpDir); } catch { /* may not be empty */ }
});
