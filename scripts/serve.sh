#!/usr/bin/env bash
set -euo pipefail

# Trusty Track Run Script

cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
    echo "Error: Virtual environment not found. Please run scripts/install.sh first."
    exit 1
fi

# Generate TLS certificates if they don't exist.
"$(dirname "$0")/generate_certs.sh"

CERT_FILE="$(realpath "$(dirname "$0")/../certs/localhost.pem")"
KEY_FILE="$(realpath "$(dirname "$0")/../certs/localhost-key.pem")"

source .venv/bin/activate
export PYTHONPATH=${PYTHONPATH:-}:$(pwd)
exec uvicorn backend.main:app --host 0.0.0.0 --port 8005 \
    --ssl-keyfile "$KEY_FILE" --ssl-certfile "$CERT_FILE"
