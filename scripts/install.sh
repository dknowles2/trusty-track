#!/usr/bin/env bash
set -euo pipefail

# Trusty Track Installation Script

cd "$(dirname "$0")/.."

echo "### Checking Prerequisites..."

# Check Python version
if command -v uv &> /dev/null; then
    echo "uv found, skipping system Python version check as uv will manage it."
elif ! command -v python3 &> /dev/null; then
    echo "Error: python3 is not installed."
    exit 1
else
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    if (( $(echo "$PYTHON_VERSION < 3.10" | bc -l) )); then
        echo "Error: Trusty Track requires Python 3.10 or higher. Found $PYTHON_VERSION"
        exit 1
    fi
fi

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "Error: node is not installed."
    exit 1
fi

# 22 is the floor, not the version we test: `.nvmrc` holds that, and it is what
# CI, the Docker image and `install-pi.sh` all use. Node 20 went end-of-life in
# April 2026 and is below several dev dependencies' own floor.
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "Error: Trusty Track requires Node.js 22 or higher. Found v$NODE_VERSION"
    exit 1
fi

echo "### Setting up Backend..."
if command -v uv &> /dev/null; then
    echo "Using uv for faster installation..."
    uv sync --python 3.12
    source .venv/bin/activate
else
    echo "uv not found, using standard venv..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -e ".[dev,docs]"
fi

echo "### Setting up Frontend..."
cd frontend
npm ci
npm run build
cd ..

echo "### Generating TLS certificates..."
./scripts/generate_certs.sh

echo "### Installing pre-commit hooks..."
if command -v pre-commit &> /dev/null; then
    pre-commit install
elif [ -f .venv/bin/pre-commit ]; then
    .venv/bin/pre-commit install
fi

echo "### Installation Complete!"
echo "To start the server, run: ./scripts/serve.sh"
