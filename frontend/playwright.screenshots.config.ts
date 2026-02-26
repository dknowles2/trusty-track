import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 5175;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const TEST_DATA_DIR = '/tmp/trusty-track-screenshots';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['screenshots.spec.ts', 'screenshot-bulk-upload.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 600000, // 10 minutes — screenshot spec runs many heats and backend API calls
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
