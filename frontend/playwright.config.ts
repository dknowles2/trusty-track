import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/functional',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.HTTPS_SERVER === 'true' ? 'https://localhost:5174' : 'http://localhost:5173',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.HTTPS_SERVER === 'true' ? 'https://localhost:5174' : 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
  },
});
