import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('take screenshots', async ({ page }) => {
  const screenshotsDir = path.resolve(__dirname, '../../docs/assets/screenshots');
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

  // Modal closes, race appears in table — click it to navigate to the race
  await expect(page.getByRole('link', { name: '2026 Pinewood Derby' })).toBeVisible();
  await page.getByRole('link', { name: '2026 Pinewood Derby' }).click();
  await page.waitForURL('**/race/*');
  await expect(page.getByRole('heading', { name: '2026 Pinewood Derby' })).toBeVisible();
  await page.waitForTimeout(500); // render elements

  await page.screenshot({ path: path.join(screenshotsDir, 'getting-started/05-race-details-empty.png') });
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/01-race-details-overview.png') });

  // Manage Dens
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
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // wait for it to generate and close modal
  await page.waitForResponse(response => response.url().includes('graphql') && response.status() === 200, { timeout: 30000 });
  await page.waitForTimeout(3000); // Give time for images to load
  
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/08-racer-list-after-import.png') });

  // Open Bulk Actions
  // Check a checkbox
  await page.locator('input[type="checkbox"]').nth(1).click();
  await page.locator('input[type="checkbox"]').nth(2).click();
  await page.getByRole('button', { name: /Bulk Actions/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/09-bulk-actions-menu.png') });

  // Final Roster Review - maybe group by den
  await page.mouse.click(0, 0); // Click body to close dropdown
  await page.waitForTimeout(300);
  await page.locator('.toggle-switch').click(); // Toggle "Group by den"
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'race-setup/10-final-roster-review.png') });
});
