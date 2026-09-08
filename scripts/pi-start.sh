#!/usr/bin/env bash
# ExecStart for the Trusty Track systemd service (scripts/install-pi.sh /
# scripts/trustytrack.service).
#
# A systemd unit file cannot express "pass these flags only if an
# environment variable is set" in `ExecStart=` itself — there is no
# conditional there — and `TRUSTYTRACK_HTTP_ONLY` (see
# docs/reference/roles-and-permissions.md#https-certificates-and-plain-http)
# needs exactly that: with it set, uvicorn
# gets no `--ssl-*` flags at all, not empty ones. So `ExecStart=` points at
# this script instead, and the branch lives in a real shell. The unit's own
# `EnvironmentFile=-/etc/trustytrack/env` is what makes the variable visible
# here.
set -euo pipefail

UVICORN="/opt/trustytrack/backend/venv/bin/uvicorn"
ARGS=(backend.api.main:app --host 0.0.0.0 --port 8000)

# Lower-cased with `tr`, not bash 4's `${var,,}` — this only ever runs on a
# Pi's own bash, but the parsing is kept identical to every other entry point
# rather than growing a second copy that could disagree
# (dknowles2/trusty-track#891). `case` rather than `[[ =~ ]]`, so there is no
# regex-quoting question to get wrong on top of it.
http_only="${TRUSTYTRACK_HTTP_ONLY:-}"
case "$(printf '%s' "$http_only" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) ;;
    *) ARGS+=(--ssl-keyfile /etc/trustytrack/key.pem --ssl-certfile /etc/trustytrack/cert.pem) ;;
esac

exec "$UVICORN" "${ARGS[@]}"
