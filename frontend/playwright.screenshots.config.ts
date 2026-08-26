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
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // The whole four-spec run takes about a minute locally and two in CI, so a
  // test still going after five is stuck, not slow. It was ten, and a stuck
  // spec then burned ten minutes before saying so.
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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
