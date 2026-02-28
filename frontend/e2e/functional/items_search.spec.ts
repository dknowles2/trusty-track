import { test, expect } from '@playwright/test';

test('search filters racers', async ({ page }) => {
  // Go to the race details page
  await page.goto('/race/1');

  // Wait for racers to load (assuming mock or real backend data, 
  // but since we don't have a backend running in this environment usually, 
  // we might need to mock the API in Playwright or rely on existing seed data if we run the backend).
  //
  // However, since we are in a dev environment, I should probably check if the backend is running.
  // The system prompt says "Operating System: linux", but doesn't guarantee the backend is up.
  // 
  // If I cannot ensure backend is running, I should mock the network requests in Playwright.
  
  // Debug requests
  page.on('request', request => console.log('>>', request.method(), request.url()));

  // Mocking the API response
  await page.route('**/api/races/1', async route => {
    await route.fulfill({ json: { id: 1, name: 'E2E Race' } });
  });

  await page.route('**/api/races/1/dens/', async route => {
     await route.fulfill({ json: [{ id: 1, name: 'Tigers', color: 'orange' }] });
  });

  await page.route('**/api/racers/?race_id=1', async route => {
    await route.fulfill({ json: [
        { id: 1, first_name: 'Alpha', last_name: 'Racer', car_number: 10, den_id: 1, car_passed_inspection: true },
        { id: 2, first_name: 'Beta', last_name: 'Driver', car_number: 20, den_id: 1, car_passed_inspection: false }
    ] });
  });

  // Verify initial state
  await expect(page.getByText('Alpha')).toBeVisible();
  await expect(page.getByText('Beta')).toBeVisible();

  // Type in the search box
  const searchInput = page.getByPlaceholder('🔍 Search racers...');
  await searchInput.fill('Alpha');

  // Verify filtering
  await expect(page.getByText('Alpha')).toBeVisible();
  await expect(page.getByText('Beta')).toBeHidden();

  // Clear and search by number
  await searchInput.fill('20');
  await expect(page.getByText('Alpha')).toBeHidden();
  await expect(page.getByText('Beta')).toBeVisible();
});
