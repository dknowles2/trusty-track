#!/usr/bin/env bash
# Trusty Track — Raspberry Pi Install Script
#
# Installs Trusty Track as a systemd service on a fresh Raspberry Pi OS Lite
# (64-bit, Bookworm / Debian 12) install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dknowles2/trusty-track/main/scripts/install-pi.sh | bash
#   # or from the cloned repo:
#   ./scripts/install-pi.sh

set -euo pipefail

INSTALL_DIR="/opt/trustytrack"
DATA_DIR="/var/lib/trustytrack"
CONF_DIR="/etc/trustytrack"
SERVICE_USER="trustytrack"
REPO_URL="https://github.com/dknowles2/trusty-track.git"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo "[trustytrack] $*"; }
success() { echo "[trustytrack] ✓ $*"; }
error()   { echo "[trustytrack] ERROR: $*" >&2; exit 1; }

require_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (use sudo)."
    fi
}

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
install_system_packages() {
    info "Updating package lists..."
    apt-get update -q

    info "Installing system packages..."
    apt-get install -y -q python3 python3-pip python3-venv git curl openssl avahi-daemon

    # Check Python version
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    info "Python version: $PYTHON_VERSION"
    if python3 -c 'import sys; exit(0 if sys.version_info >= (3,10) else 1)'; then
        success "Python version OK"
    else
        error "Trusty Track requires Python 3.10 or higher. Found $PYTHON_VERSION"
    fi

    # Install Node.js 20 from NodeSource if needed
    NODE_OK=false
    if command -v node &>/dev/null; then
        NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_MAJOR" -ge 18 ]]; then
            NODE_OK=true
        fi
    fi

    if [[ "$NODE_OK" == "false" ]]; then
        info "Installing Node.js 20 from NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y -q nodejs
    fi
    success "Node.js $(node -v) OK"
}

# ---------------------------------------------------------------------------
# 2. Clone or update the repository
# ---------------------------------------------------------------------------
install_source() {
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Updating existing installation at $INSTALL_DIR..."
        git -C "$INSTALL_DIR" pull
    else
        info "Cloning Trusty Track to $INSTALL_DIR..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    success "Source code ready"
}

# ---------------------------------------------------------------------------
# 3 & 4. Build frontend and install Python dependencies
# ---------------------------------------------------------------------------
build_app() {
    info "Installing Python dependencies..."
    python3 -m venv "$INSTALL_DIR/backend/venv"
    "$INSTALL_DIR/backend/venv/bin/pip" install --quiet -r "$INSTALL_DIR/backend/requirements.txt"
    success "Python dependencies installed"

    info "Building frontend (this may take a few minutes)..."
    cd "$INSTALL_DIR/frontend"
    npm ci --silent
    npm run build --silent
    cd -
    success "Frontend built"
}

# ---------------------------------------------------------------------------
# 5 & 6. Create system user and data directory
# ---------------------------------------------------------------------------
setup_user_and_dirs() {
    if ! id -u "$SERVICE_USER" &>/dev/null; then
        info "Creating system user '$SERVICE_USER'..."
        useradd --system \
                --home "$INSTALL_DIR" \
                --shell /usr/sbin/nologin \
                "$SERVICE_USER"
    fi

    mkdir -p "$DATA_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    success "User and data directories configured"
}

# ---------------------------------------------------------------------------
# 7. Generate self-signed TLS certificate
# ---------------------------------------------------------------------------
setup_tls() {
    mkdir -p "$CONF_DIR"

    if [[ -f "$CONF_DIR/cert.pem" && -f "$CONF_DIR/key.pem" ]]; then
        info "TLS certificate already exists, skipping generation"
        return
    fi

    info "Generating self-signed TLS certificate..."
    openssl req -x509 \
        -newkey rsa:4096 \
        -keyout "$CONF_DIR/key.pem" \
        -out "$CONF_DIR/cert.pem" \
        -days 3650 \
        -nodes \
        -subj "/CN=trustytrack.local" \
        2>/dev/null
    chmod 640 "$CONF_DIR/key.pem"
    chown root:"$SERVICE_USER" "$CONF_DIR/key.pem"
    success "TLS certificate generated"
}

# ---------------------------------------------------------------------------
# 8. Write environment file
# ---------------------------------------------------------------------------
setup_env() {
    mkdir -p "$CONF_DIR"
    cat > "$CONF_DIR/env" <<EOF
TRUSTYTRACK_DATA_DIR=$DATA_DIR
EOF
    success "Environment file written to $CONF_DIR/env"
}

# ---------------------------------------------------------------------------
# 8. Install and enable systemd service
# ---------------------------------------------------------------------------
install_service() {
    # Write the service unit from the bundled file if available, else inline it
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$SCRIPT_DIR/trustytrack.service" ]]; then
        cp "$SCRIPT_DIR/trustytrack.service" /etc/systemd/system/trustytrack.service
    else
        cat > /etc/systemd/system/trustytrack.service <<'SERVICE'
[Unit]
Description=Trusty Track Race Management
After=network.target

[Service]
Type=simple
User=trustytrack
WorkingDirectory=/opt/trustytrack/backend
EnvironmentFile=-/etc/trustytrack/env
ExecStart=/opt/trustytrack/backend/venv/bin/uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --ssl-keyfile /etc/trustytrack/key.pem \
    --ssl-certfile /etc/trustytrack/cert.pem
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
    fi

    systemctl daemon-reload
    systemctl enable trustytrack
    systemctl restart trustytrack
    success "Trusty Track service enabled and started"
}

# ---------------------------------------------------------------------------
# 9. Configure mDNS hostname
# ---------------------------------------------------------------------------
setup_mdns() {
    info "Configuring mDNS hostname (trustytrack.local)..."
    hostnamectl set-hostname trustytrack
    systemctl enable avahi-daemon
    systemctl start avahi-daemon
    success "mDNS configured — Pi will be reachable at trustytrack.local"
}

# ---------------------------------------------------------------------------
# 10. Optional: Wi-Fi hotspot mode
# ---------------------------------------------------------------------------
setup_hotspot() {
    echo
    read -r -p "Set up Wi-Fi hotspot mode? (recommended for venues without Wi-Fi) [y/N] " HOTSPOT
    if [[ "${HOTSPOT,,}" != "y" ]]; then
        return
    fi

    info "Installing hostapd and dnsmasq..."
    apt-get install -y -q hostapd dnsmasq

    info "Configuring hotspot (SSID: TrustyTrack)..."

    # Configure static IP on wlan0
    cat >> /etc/dhcpcd.conf <<'EOF'

# Trusty Track hotspot
interface wlan0
    static ip_address=192.168.73.1/24
    nohook wpa_supplicant
EOF

    # Configure dnsmasq
    cat > /etc/dnsmasq.d/trustytrack.conf <<'EOF'
interface=wlan0
dhcp-range=192.168.73.10,192.168.73.100,255.255.255.0,24h
address=/trustytrack.local/192.168.73.1
EOF

    # Configure hostapd
    cat > /etc/hostapd/hostapd.conf <<'EOF'
interface=wlan0
driver=nl80211
ssid=TrustyTrack
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
EOF

    sed -i 's|#DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd

    systemctl unmask hostapd
    systemctl enable hostapd dnsmasq
    systemctl restart hostapd dnsmasq

    success "Hotspot configured — connect to 'TrustyTrack' Wi-Fi, then open https://trustytrack.local:8000"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    require_root

    echo "======================================"
    echo "  Trusty Track — Raspberry Pi Setup"
    echo "======================================"
    echo

    install_system_packages
    install_source
    build_app
    setup_user_and_dirs
    setup_tls
    setup_env
    install_service
    setup_mdns

    # Wait briefly and check service status
    sleep 3
    if systemctl is-active --quiet trustytrack; then
        success "Service is running"
    else
        echo
        echo "WARNING: Service did not start. Check logs with: journalctl -u trustytrack -n 50"
    fi

    setup_hotspot

    # Print access info
    PI_IP=$(hostname -I | awk '{print $1}')
    echo
    echo "======================================"
    echo "  Installation Complete!"
    echo "======================================"
    echo
    echo "Access Trusty Track at:"
    echo "  https://$PI_IP:8000         (by IP address)"
    echo "  https://trustytrack.local:8000   (mDNS — from any device on the network)"
    echo
    echo "Note: Your browser will warn about the self-signed certificate."
    echo "Click 'Advanced' → 'Proceed to trustytrack.local (unsafe)' to continue."
    echo
    echo "To check the service status:  sudo systemctl status trustytrack"
    echo "To view logs:                 sudo journalctl -u trustytrack -f"
    echo

    # Print QR code if qrencode is available
    if command -v qrencode &>/dev/null; then
        echo "Scan to open on your phone:"
        qrencode -t ansiutf8 "https://$PI_IP:8000"
    fi
}

main "$@"
