#!/usr/bin/env bash
set -euo pipefail

# Trusty Track Run Script

cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
    echo "Error: Virtual environment not found. Please run scripts/install.sh first."
    exit 1
fi

source .venv/bin/activate
export PYTHONPATH=${PYTHONPATH:-}:$(pwd)
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
