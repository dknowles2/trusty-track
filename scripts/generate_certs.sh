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

# Detect the primary outbound LAN IP so remote devices can connect over HTTPS.
LOCAL_IP=$(python3 -c "
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    print(s.getsockname()[0])
    s.close()
except Exception:
    print('127.0.0.1')
" 2>/dev/null || echo "127.0.0.1")

echo "Including SAN for localhost and $LOCAL_IP"

# Generate self-signed certificate with Subject Alternative Names so modern
# browsers accept it for both localhost and the LAN IP address.
openssl req -x509 -newkey rsa:4096 -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -days 3650 -nodes \
    -subj "/CN=TrustyTrack" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LOCAL_IP" \
    -addext "basicConstraints=CA:TRUE"

echo "Certificates generated successfully."
