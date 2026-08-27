import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    SCREENSHOT_BACKEND_PORT,
    SCREENSHOT_BACKEND_URL,
    SCREENSHOT_DATA_DIR,
    SCREENSHOT_FRONTEND_PORT,
} from './e2e/environment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
// Derived from this checkout rather than fixed: see `e2e/environment.ts`.
const BACKEND_PORT = SCREENSHOT_BACKEND_PORT;
const FRONTEND_PORT = SCREENSHOT_FRONTEND_PORT;
const BACKEND_URL = SCREENSHOT_BACKEND_URL;
const TEST_DATA_DIR = SCREENSHOT_DATA_DIR;

export default defineConfig({
  testDir: './e2e/docs',
  testMatch: ['*.spec.ts'],
  // Files run in parallel across workers; the tests inside one file stay in
  // order. That is the split these specs want — each seeds its own race and
  // photographs its own screens, and the one place a picture depends on the
  // step before it (`screenshots.spec.ts`) is a single test.
  //
  // Scaled to the machine locally, pinned in CI. Ten cores here run the set in
  // 23 seconds against 30 at four workers, so leaving it at four wastes a third
  // of the run on a developer's laptop — but a hosted runner has a fraction of
  // that, and every worker drives a real browser against the one shared
  // backend, so a number chosen for a laptop is oversubscription there.
  fullyParallel: false,
  workers: process.env.CI ? 4 : '75%',
  reporter: 'list',
  // A spec still going after five minutes is stuck, not slow: the longest one
  // drives a whole event through the browser and takes well under one.
  timeout: 300000,
  // One retry in CI. These drive a real backend, a real browser and a fake
  // timer over a WebSocket on a shared runner, and a heat that does not arm
  // within the deadline is usually that rather than a broken spec — the same
  // trade the functional e2e config already makes. A break that reproduces
  // still fails twice.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'off',
    // Playwright's default action timeout is *no* timeout, so a click on a
    // locator that never appears is bounded only by the whole test's five
    // minutes — which is what a stuck spec looked like: five minutes of
    // nothing and a summary line naming the file rather than the step. These
    // are generous for a page that is up, and turn a hang into a failure that
    // says which control it was waiting for.
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  // Two phases. `first-run` is a Playwright *setup project* every other
  // project depends on, so it runs first whatever is being filtered to, and it
  // owns everything that belongs to the **install** rather than to a race: the
  // setup wizard (which a configured install never shows), the empty Home page,
  // the operator PIN, and the activity log. Everything else is race-scoped or
  // owns its own track, and runs together.
  //
  // It was three phases: `screenshot-settings.spec.ts` had its own, because it
  // sets an operator PIN for a couple of seconds and while one is set every
  // caller without it is a `VIEWER` and no mutation is allowed (#15). Moving
  // that one picture — and the activity log, which is a list of what *everyone*
  // has done — into `first-run` let the rest of that page join the pool.
  projects: [
    {
      name: 'first-run',
      testMatch: /screenshot-first-run\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'screenshots',
      testIgnore: [/screenshot-first-run\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['first-run'],
    },
  ],
  webServer: [
    {
      // Clean data dir then start a fresh backend on an isolated port
      command: `rm -rf ${TEST_DATA_DIR} && mkdir -p ${TEST_DATA_DIR} && .venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: false,
      cwd: PROJECT_ROOT,
      env: {
        TRUSTYTRACK_DATA_DIR: TEST_DATA_DIR,
        PYTHONPATH: PROJECT_ROOT,
        // Two things the app invents are what made every screenshot differ on
        // every run: the fake timer's lane times, and the roster `populateRace`
        // makes up. This makes both repeat, so a regeneration that changed
        // nothing visible produces no diff at all — which is the difference
        // between fifty binary files being a signal and being noise. The value
        // is arbitrary; what matters is that it never changes. See
        // `backend/demo_seed.py`.
        TRUSTYTRACK_DEMO_SEED: 'trusty-track-docs',
      },
    },
    {
      // Fresh frontend proxying to the test backend
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
