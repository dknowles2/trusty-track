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

# TRUSTYTRACK_HTTP_ONLY (see
# docs/reference/roles-and-permissions.md#https-certificates-and-plain-http)
# opts out of HTTPS
# entirely — the camera and check-in scanner then only work on the machine
# running the server, but there is no certificate warning for anybody else to
# click through. Off by default: every install that has not heard of this
# still gets HTTPS, exactly as it always has.
http_only="${TRUSTYTRACK_HTTP_ONLY:-}"
if [[ "${http_only,,}" =~ ^(1|true|yes|on)$ ]]; then
    echo "TRUSTYTRACK_HTTP_ONLY is set — serving plain HTTP, no certificate."
    exec uvicorn backend.api.main:app --host 0.0.0.0 --port 8005
fi

# Generate TLS certificates if they don't exist.
"$(dirname "$0")/generate_certs.sh"

CERT_FILE="$(realpath "$(dirname "$0")/../certs/localhost.pem")"
KEY_FILE="$(realpath "$(dirname "$0")/../certs/localhost-key.pem")"

exec uvicorn backend.api.main:app --host 0.0.0.0 --port 8005 \
    --ssl-keyfile "$KEY_FILE" --ssl-certfile "$CERT_FILE"
