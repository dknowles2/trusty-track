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
  //
  // `instantReplay.spec.ts` is its own project, deliberately kept off the
  // `chromium` worker pool (#1205). Its tests do real WebCodecs capture,
  // encode and a multi-MB `POST /replay/` upload — on a 2-core CI runner,
  // that contends for CPU and for the one Vite dev server every spec's
  // requests (including `/replay/` itself, per `vite.config.ts`'s proxy
  // table) share. Measured on PR #1203's run (35286523323): both of
  // `instantReplay`'s upload waits stalled their full 90s ceiling under that
  // contention, and while they stalled the dev server logged continuous
  // `ECONNRESET`/`EPIPE` and *unrelated* specs on other workers of the same
  // shard failed on ordinary clicks and GraphQL posts (`intermission.spec.ts`,
  // `laneShrink.spec.ts`, `liveBadgeLayout.spec.ts`, `debugAndThemes.spec.ts`).
  //
  // `testIgnore` on `chromium` plus `testMatch` here keep the file off the
  // parallel pool, and `fullyParallel: false` on `replay` keeps its own
  // twelve tests running one at a time on a single worker rather than racing
  // each other across up to four — the same reasoning the file's own
  // `describe.serial` block already applies to its four stored-clip tests,
  // extended to the whole file. That caps how much *encoding* work this file
  // can ever have in flight at once, from as many as `workers` in parallel
  // down to one.
  //
  // What this does **not** do is make `replay` run strictly after `chromium`
  // finishes. The natural way to ask for that is `dependencies: ['setup',
  // 'chromium']` — tried first, and reverted after measuring it against
  // `--shard`: Playwright resolves a project's full dependency chain before
  // sharding the result, so every `chromium` test (the whole dependency
  // `replay` names) plus every `replay` test landed in shard 1 alone, and
  // shard 2 listed zero tests (`npx playwright test --list --shard=1/2` vs
  // `--shard=2/2`, both against this exact tree). `.claude/rules/
  // documentation.md`'s own screenshot section already recorded this same
  // failure for the doc-screenshots timers spec — "Playwright pulls a
  // project's whole dependency chain into the shard that runs it" — and it
  // reproduces here identically. So `replay` depends only on `setup`, the
  // same as `chromium`; on CI it is scheduled onto its own worker
  // (`workers: 4`, three projects) and can start alongside `chromium`'s
  // tests rather than strictly after them. The single-worker, one-at-a-time
  // constraint above is what actually carries the fix: at most one heavy
  // encode-and-upload runs at any moment instead of up to four, which is
  // most of the contention this issue measured. See `.claude/rules/ci.md`'s
  // "What CI checks" for how this composes with `--shard`.
  projects: [
    {
      name: 'setup',
      testMatch: /configure\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /instantReplay\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'replay',
      testMatch: /instantReplay\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
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
