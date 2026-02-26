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
export VITE_BACKEND_SECURE=false
export VITE_BACKEND_URL=https://localhost:8005


# Start Backend (HTTPS :8005)
echo "Starting Backend (HTTPS :8005)..."
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8005 --ssl-keyfile "$KEY_FILE" --ssl-certfile "$CERT_FILE" > backend.log 2>&1 &
BACKEND_PID=$!


# Start Frontend (HTTP :5173)
echo "Starting Frontend (HTTP :5173)..."
cd "$PROJECT_ROOT/frontend"
# Clear Vite cache to avoid outdated optimize dep errors
rm -rf node_modules/.vite
npm run dev &
FRONTEND_HTTP_PID=$!

# Start Frontend (HTTPS :5174)
echo "Starting Frontend (HTTPS :5174)..."
HTTPS_SERVER=true npm run dev &
FRONTEND_HTTPS_PID=$!

# Wait for all processes
wait $BACKEND_PID $FRONTEND_HTTP_PID $FRONTEND_HTTPS_PID
