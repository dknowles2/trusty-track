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
  
  // Mocking the GraphQL API response
  await page.route('**/api/graphql*', async route => {
    const request = route.request();
    let operationName;
    
    if (request.method() === 'POST') {
      const postData = request.postDataJSON();
      operationName = postData?.operationName;
    } else {
      const url = new URL(request.url());
      operationName = url.searchParams.get('operationName');
    }
    
    if (operationName === 'GetRaceDetails') {
      await route.fulfill({
        json: {
          data: {
            race: {
              id: 1,
              name: 'E2E Race',
              dateTime: '2023-01-01T12:00:00Z',
              location: 'Track 1',
              scoringStrategy: 'TIMED',
              carNumberingStrategy: 'MANUAL',
              globalStartNumber: 1,
              championshipTrophies: 3,
              registeredCount: 2,
              checkedInCount: 1,
              dens: [
                { id: 1, name: 'Tigers', color: 'orange', rank: 'Tigers', carNumberRangeStart: 100, carNumberRangeEnd: 199 }
              ],
              racers: [
                { id: 1, firstName: 'Alpha', lastName: 'Racer', carNumber: 10, denId: 1, carName: 'A-Car', carPassedInspection: true, carWeight: 5.0, racerImageUrl: null, carImageUrl: null },
                { id: 2, firstName: 'Beta', lastName: 'Driver', carNumber: 20, denId: 1, carName: 'B-Car', carPassedInspection: false, carWeight: 5.0, racerImageUrl: null, carImageUrl: null }
              ],
              leaderboard: [],
              scheduledRacerIds: []
            },
            tracks: [
              { id: 1, name: 'Main Track', laneCount: 3 }
            ]
          }
        }
      });
    } else if (operationName === 'GetRacesNav') {
      await route.fulfill({
        json: {
          data: {
            races: [{ id: 1, name: 'E2E Race' }]
          }
        }
      });
    } else if (operationName === 'GetInitialConfig') {
        await route.fulfill({
            json: {
                data: {
                    initialConfig: { initialized: true, version: '1.0.0', debugMode: false }
                }
            }
        });
    } else {
      await route.continue();
    }
  });

  // Verify initial state
  await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(page.getByText('Beta', { exact: true })).toBeVisible();

  // Type in the search box
  const searchInput = page.getByPlaceholder('Search racers...');
  await searchInput.fill('Alpha');

  // Verify filtering
  await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(page.getByText('Beta', { exact: true })).toBeHidden();

  // Clear and search by number
  await searchInput.fill('20');
  await expect(page.getByText('Alpha', { exact: true })).toBeHidden();
  await expect(page.getByText('Beta', { exact: true })).toBeVisible();
});
