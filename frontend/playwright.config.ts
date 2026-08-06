import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Its own ports and its own database, so a functional run neither collides with
// a dev server nor touches the operator's real data. Not 5173: the dev config
// redirects that port to HTTPS, which is what made `npm run test:e2e` time out
// waiting for a server that was answering a 301.
const BACKEND_PORT = 8002;
const FRONTEND_PORT = 5177;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const TEST_DATA_DIR = '/tmp/trusty-track-e2e';

export default defineConfig({
  testDir: './e2e/functional',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'html',
  // Playwright's default is 30 seconds for the whole test, which the race-day
  // specs spend before they start: seeding a race is a dozen GraphQL round
  // trips, and arming a heat then waiting on a subscription is most of a
  // minute on a loaded runner. A spec still going after two minutes is stuck
  // rather than slow.
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // A real backend, not mocked GraphQL. The mocks this replaces were written
  // before the normalized cache landed (#12) and answered without `__typename`,
  // which graphcache cannot store — so the page rendered nothing and the only
  // functional test failed, unnoticed, because nothing ran it.
  webServer: [
    {
      command:
        `rm -rf ${TEST_DATA_DIR} && mkdir -p ${TEST_DATA_DIR} && ` +
        `uv run uvicorn backend.api.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: false,
      cwd: PROJECT_ROOT,
      env: {
        TRUSTYTRACK_DATA_DIR: TEST_DATA_DIR,
        PYTHONPATH: PROJECT_ROOT,
      },
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      env: {
        VITE_BACKEND_URL: BACKEND_URL,
        VITE_BACKEND_SECURE: 'false',
      },
    },
  ],
});
