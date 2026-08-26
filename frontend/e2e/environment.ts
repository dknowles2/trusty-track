/**
 * Where the end-to-end runs put their servers and their data.
 *
 * Several worktrees of this repository are a normal way to work, and they
 * share one machine. Three things here were global to that machine rather
 * than to the checkout, and each broke a parallel run in its own way:
 *
 * The **data directory** is deleted before each run starts, so one run wiped
 * another's database and uploads while they were in use — quietly, since the
 * run doing the deleting saw nothing wrong.
 *
 * The **ports** were fixed, so the second worktree to start simply could not:
 * `http://127.0.0.1:8002/health is already used`. Loud, at least, but it means
 * nobody can run these while another checkout is running them.
 *
 * The **backend URL** was written out in eleven spec files, which is why the
 * ports could not be changed in one place to begin with. It is imported now.
 *
 * All three are derived from this checkout's path. `backend/tests/data_dir.py`
 * is the same rule for the pytest suite, which had the same problem.
 *
 * Ports are *derived*, not allocated: the same checkout gets the same port on
 * every run, so a server left behind by a killed run is on the port the next
 * one wants — which is a thing a person can find and stop. An allocated free
 * port would move every run and hide it. Nothing guarantees the port is free,
 * but Playwright says so plainly when it is not.
 */

import { createHash } from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** The repository root, from this file's own location. */
export const PROJECT_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
);

/** Eight hex characters of the checkout's path. Stable, and unique enough. */
export function checkoutToken(root: string = PROJECT_ROOT): string {
    return createHash('sha256').update(root).digest('hex').slice(0, 8);
}

/** A port for this checkout, `base` to `base + span - 1`. */
export function checkoutPort(base: number, span = 200, root: string = PROJECT_ROOT): number {
    return base + (parseInt(checkoutToken(root), 16) % span);
}

// The functional suite. Deliberately not 5173 for the frontend: the dev config
// redirects that port to HTTPS, which is what made `npm run test:e2e` time out
// waiting for a server that was answering a 301.
export const FUNCTIONAL_BACKEND_PORT = checkoutPort(8100);
export const FUNCTIONAL_FRONTEND_PORT = checkoutPort(5300);
export const FUNCTIONAL_BACKEND_URL = `http://127.0.0.1:${FUNCTIONAL_BACKEND_PORT}`;
export const FUNCTIONAL_DATA_DIR = `/tmp/trusty-track-e2e-${checkoutToken()}`;

// The documentation screenshots, on their own everything: they run beside the
// functional suite in CI, and a person regenerating images should not have to
// stop whatever else is running.
export const SCREENSHOT_BACKEND_PORT = checkoutPort(8300);
export const SCREENSHOT_FRONTEND_PORT = checkoutPort(5500);
export const SCREENSHOT_BACKEND_URL = `http://127.0.0.1:${SCREENSHOT_BACKEND_PORT}`;
export const SCREENSHOT_DATA_DIR = `/tmp/trusty-track-screenshots-${checkoutToken()}`;
