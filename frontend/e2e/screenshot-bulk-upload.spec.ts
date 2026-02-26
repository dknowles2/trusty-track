/**
 * Playwright spec to capture screenshots of the Bulk Photo Upload modal
 * for docs/race-day.md.
 *
 * Run with:
 *   npx playwright test e2e/screenshot-bulk-upload.spec.ts --headed
 *
 * Assumes the Vite dev server is running at http://localhost:5173 and the
 * backend is reachable (the Vite proxy handles the SSL tunnel to port 8005).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/assets/screenshots/race-day');

// Minimal valid 1×1 white JPEG (SOI + APP0 + DQT + SOF0 + DHT + SOS + EOI)
const MINIMAL_JPEG = Buffer.from([
    0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,
    0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xff,0xdb,0x00,0x43,
    0x00,0x10,0x0b,0x0c,0x0e,0x0c,0x0a,0x10,0x0e,0x0d,0x0e,0x12,
    0x11,0x10,0x13,0x18,0x28,0x1a,0x18,0x16,0x16,0x18,0x31,0x23,
    0x25,0x1d,0x28,0x3a,0x33,0x3d,0x3c,0x39,0x33,0x38,0x37,0x40,
    0x48,0x5c,0x4e,0x40,0x44,0x57,0x45,0x37,0x38,0x50,0x6d,0x51,
    0x57,0x5f,0x62,0x67,0x68,0x67,0x3e,0x4d,0x71,0x79,0x70,0x64,
    0x78,0x5c,0x65,0x67,0x63,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,
    0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xc4,0x00,0x1f,0x00,0x00,
    0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,
    0x09,0x0a,0x0b,0xff,0xc4,0x00,0xb5,0x10,0x00,0x02,0x01,0x03,
    0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7d,
    0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,
    0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,
    0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,
    0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,
    0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,
    0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,
    0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,
    0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
    0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,
    0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,
    0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,
    0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,
    0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,
    0xf5,0xf6,0xf7,0xf8,0xf9,0xfa,0xff,0xda,0x00,0x08,0x01,0x01,
    0x00,0x00,0x3f,0x00,0xf5,0x0f,0xff,0xd9,
]);

test('screenshot bulk photo upload modal', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 880 });

    // Intercept uploadImage GraphQL mutation — return a stable fake URL so
    // uploads complete instantly without writing to disk.
    let uploadCallCount = 0;
    await page.route('**/graphql', async (route) => {
        const body = route.request().postDataJSON() as { query?: string } | null;
        if (body?.query?.includes('uploadImage') || body?.query?.includes('UploadImage')) {
            uploadCallCount++;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { uploadImage: `/static/demo-racer-${uploadCallCount}.jpg` },
                }),
            });
        } else {
            await route.continue();
        }
    });

        // ── Navigate to Home and create a race first ───────────────────────────
        await page.goto('/', { waitUntil: 'networkidle' });
    
        if (page.url().includes('/system-settings')) {
            await page.getByLabel('Organization Name').fill('Bulk Test Pack');
            await page.getByRole('button', { name: 'Save Settings' }).click();
            await page.waitForURL('**/', { waitUntil: 'networkidle' });
        }
    
        await page.getByRole('button', { name: /Create New Race/i }).click();
    await page.getByPlaceholder('e.g. 2024 Pinewood Derby').fill('Bulk Upload Race');
    await page.getByRole('button', { name: 'Create Race' }).click();
    await expect(page.getByRole('link', { name: 'Bulk Upload Race' })).toBeVisible();
    await page.getByRole('link', { name: 'Bulk Upload Race' }).click();
    await page.waitForURL('**/race/*');
    await page.waitForTimeout(600);

    // Populate test data so we have racers
    await page.locator('.split-btn-arrow').click();
    await page.getByText(/Populate Test Data/i).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForResponse(response => response.url().includes('graphql') && response.status() === 200, { timeout: 30000 });
    await page.waitForTimeout(1000);

    // ── Screenshot 1: toolbar with Upload Photos button highlighted ─────────
    // Scroll to top so the toolbar is visible
    await page.evaluate(() => window.scrollTo(0, 0));
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
    const filePaths = ['racer-01.jpg', 'racer-02.jpg', 'racer-03.jpg'].map(name => {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, MINIMAL_JPEG);
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
    const firstCombobox = page.locator('input[placeholder="— Assign to racer —"]').first();
    await firstCombobox.click();
    await page.waitForTimeout(350);

    // ── Screenshot 4: combobox open, showing full racer list ────────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '22-bulk-upload-combobox-open.png'),
    });

    // Type to filter — use a short name fragment that matches ~1 racer
    await firstCombobox.fill('jax');
    await page.waitForTimeout(250);

    // ── Screenshot 5: combobox filtered to matching racer ───────────────────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '23-bulk-upload-combobox-filtered.png'),
    });

    // Select the top result with Enter
    await firstCombobox.press('Enter');
    await page.waitForTimeout(300);

    // Assign a second photo
    const secondCombobox = page.locator('input[placeholder="— Assign to racer —"]').nth(1);
    await secondCombobox.click();
    await secondCombobox.fill('ozz');
    await page.waitForTimeout(250);
    await secondCombobox.press('Enter');
    await page.waitForTimeout(300);

    // ── Screenshot 6: modal with 2 photos assigned, Apply button active ─────
    await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '24-bulk-upload-assigned.png'),
    });

    // Cleanup tmp files
    filePaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
    try { fs.rmdirSync(tmpDir); } catch { /* may not be empty */ }
});
