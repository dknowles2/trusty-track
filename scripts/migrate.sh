#!/bin/bash
set -euo pipefail

# Run Alembic against a disposable scratch data directory (#689).
#
# `uv run alembic ...` run directly opens whatever TRUSTYTRACK_DATA_DIR
# resolves to — for anyone who has not set it, that is ~/.trustytrack, the
# same file a real install's event and every uploaded photograph of a child
# live in. `backend/migrations/env.py` refuses that case outright once the
# database holds a configured race, but the safe way to run the documented
# migration workflow is to never point Alembic there at all. This script does
# that by construction: a fresh temporary directory, deleted when it exits.
#
# The scratch directory is upgraded to head before your own command runs, so
# `revision --autogenerate` diffs the models against a fully-migrated (but
# empty) schema rather than a blank one — the same shape a real install's
# database is in when you change models.py, and what makes the generated
# migration match what a real upgrade would actually do.
#
# Usage:
#   ./scripts/migrate.sh revision --autogenerate -m "describe the change"
#   ./scripts/migrate.sh upgrade head
#   ./scripts/migrate.sh check
#   ./scripts/migrate.sh downgrade -1

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <alembic command> [args...]" >&2
    echo "e.g.:  $0 revision --autogenerate -m \"describe the change\"" >&2
    exit 1
fi

SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT

export TRUSTYTRACK_DATA_DIR="$SCRATCH_DIR"

echo "Migrating a scratch database at $SCRATCH_DIR to head..."
uv run alembic upgrade head >/dev/null

uv run alembic "$@"
