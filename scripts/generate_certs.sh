#!/bin/bash

# Define the directory for certificates
CERT_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERT_DIR"

# Define certificate files
KEY_FILE="$CERT_DIR/localhost-key.pem"
CERT_FILE="$CERT_DIR/localhost.pem"

# Check if certificates already exist
if [ -f "$KEY_FILE" ] && [ -f "$CERT_FILE" ]; then
    echo "Certificates already exist in $CERT_DIR"
    exit 0
fi

echo "Generating self-signed certificates in $CERT_DIR..."

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -days 365 -nodes -subj "/CN=localhost"

echo "Certificates generated successfully."
