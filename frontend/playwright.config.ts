import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    FUNCTIONAL_BACKEND_PORT,
    FUNCTIONAL_BACKEND_URL,
    FUNCTIONAL_DATA_DIR,
    FUNCTIONAL_FRONTEND_PORT,
} from './e2e/environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Its own ports and its own database, so a functional run neither collides with
// a dev server nor touches the operator's real data.
// Ports and data directory are derived from this checkout rather than fixed,
// so two worktrees can run these at the same time without one refusing to
// start and the other silently deleting its database. See
// `e2e/environment.ts`.
const BACKEND_PORT = FUNCTIONAL_BACKEND_PORT;
const FRONTEND_PORT = FUNCTIONAL_FRONTEND_PORT;
const BACKEND_URL = FUNCTIONAL_BACKEND_URL;
const TEST_DATA_DIR = FUNCTIONAL_DATA_DIR;

export default defineConfig({
  testDir: './e2e/functional',
  // Every spec seeds its own race through the API and drives one screen, so
  // tests are independent and run together — including the tests *within* a
  // file, which is what `fullyParallel` adds. `raceDay.spec.ts` is a third of
  // the suite on its own; without it that file alone would be the floor.
  //
  // The one thing that was not race-scoped was `timerModel.spec.ts`, which
  // switched a track off the fake timer and never switched it back; it takes a
  // track of its own now.
  fullyParallel: true,
  workers: process.env.CI ? 4 : '75%',
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
  // `setup` configures the install and every test waits for it — see
  // `configure.setup.ts`. It is a project rather than a `globalSetup` so it
  // reports as a test and fails visibly when the app cannot be configured at
  // all, which is a thing worth knowing before fifty-nine specs say so at once.
  projects: [
    {
      name: 'setup',
      testMatch: /configure\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
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
