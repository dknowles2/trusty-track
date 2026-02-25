#!/usr/bin/env bash
set -euo pipefail

# Trusty Track Installation Script

cd "$(dirname "$0")/.."

echo "### Checking Prerequisites..."

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is not installed."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
if (( $(echo "$PYTHON_VERSION < 3.10" | bc -l) )); then
    echo "Error: Trusty Track requires Python 3.10 or higher. Found $PYTHON_VERSION"
    exit 1
fi

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "Error: node is not installed."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Trusty Track requires Node.js 18 or higher. Found v$NODE_VERSION"
    exit 1
fi

echo "### Setting up Backend..."
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

echo "### Setting up Frontend..."
cd frontend
npm ci
npm run build
cd ..

echo "### Generating TLS certificates..."
./scripts/generate_certs.sh

echo "### Installation Complete!"
echo "To start the server, run: ./scripts/serve.sh"
