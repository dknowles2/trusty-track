import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { TEST_DATA_DIR } from './e2e/screenshots-setup';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 5175;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/screenshots.spec.ts',
  globalSetup: './e2e/screenshots-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
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
      // Fresh backend with isolated data directory
      command: `.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: false,
      cwd: PROJECT_ROOT,
      env: {
        TRUSTYTRACK_DATA_DIR: TEST_DATA_DIR,
        PYTHONPATH: PROJECT_ROOT,
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
