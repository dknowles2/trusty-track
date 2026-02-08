#!/bin/bash

# Function to kill all child processes on exit
cleanup() {
    echo "Stopping services..."
    kill $(jobs -p) 2>/dev/null
}

trap cleanup EXIT

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Start Backend
echo "Starting Backend..."
cd "$PROJECT_ROOT"
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi
# Generate certificates if they don't exist
"$SCRIPT_DIR/generate_certs.sh"

export CERT_FILE="$PROJECT_ROOT/certs/localhost.pem"
export KEY_FILE="$PROJECT_ROOT/certs/localhost-key.pem"

# Start Backend (HTTP :8000)
echo "Starting Backend (HTTP :8000)..."
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_HTTP_PID=$!

# Start Backend (HTTPS :8001)
echo "Starting Backend (HTTPS :8001)..."
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001 --ssl-keyfile "$KEY_FILE" --ssl-certfile "$CERT_FILE" &
BACKEND_HTTPS_PID=$!

# Start Frontend (HTTP :5173)
echo "Starting Frontend (HTTP :5173)..."
cd "$PROJECT_ROOT/frontend"
npm run dev &
FRONTEND_HTTP_PID=$!

# Start Frontend (HTTPS :5174)
echo "Starting Frontend (HTTPS :5174)..."
HTTPS_SERVER=true npm run dev &
FRONTEND_HTTPS_PID=$!

# Wait for all processes
wait $BACKEND_HTTP_PID $BACKEND_HTTPS_PID $FRONTEND_HTTP_PID $FRONTEND_HTTPS_PID
