/**
 * #742 — `TRUSTYTRACK_HTTP_ONLY=1 ./scripts/run_dev.sh` starts only the
 * `:5173` frontend (there is no backend certificate for the `:5174` HTTPS
 * variant to proxy to — see `scripts/run_dev.sh`), but the `redirect-to-https`
 * plugin in `vite.config.ts` was gated only on `HTTPS_SERVER === 'true'`, so
 * it 301-ed every `:5173` request to `https://…:5174` regardless — a page
 * the browser then reports as connection-refused.
 *
 * `httpOnlyRequested` mirrors the shell script's own case-insensitive
 * `1|true|yes|on` test (`scripts/run_dev.sh`'s `http_only` check), reading
 * whatever `loadEnv` handed back rather than `process.env` directly — the
 * same "one pure function, tested with no server or environment mutation"
 * shape `backend/tests/test_http_mode.py` uses for the backend's own half
 * of this flag.
 */

import { describe, expect, it } from 'vitest';
import { httpOnlyRequested } from './vite.config';

describe('httpOnlyRequested (#742)', () => {
  it('is false when the variable is absent, same as every install today', () => {
    expect(httpOnlyRequested({})).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'ON'])(
    'is true for %s, matching run_dev.sh\'s own regex',
    (value) => {
      expect(httpOnlyRequested({ TRUSTYTRACK_HTTP_ONLY: value })).toBe(true);
    },
  );

  it.each(['0', 'false', '', 'nope'])('is false for %s', (value) => {
    expect(httpOnlyRequested({ TRUSTYTRACK_HTTP_ONLY: value })).toBe(false);
  });
});
