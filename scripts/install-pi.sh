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
#
# This file is also *sourced*, never executed, by the pi-gen stage under
# `deploy/raspberry-pi/` — the pre-built image reuses these functions rather
# than reimplementing "what a working install is" a second time. `main` runs
# only when the file is executed directly (see the guard at the bottom), so a
# caller that sources it gets the functions with none of the side effects and
# can call just the ones a chroot has no running systemd or D-Bus to support
# (`install_service` enables the unit without `restart`ing it; there is no
# `start_service` equivalent of `setup_mdns`'s `hostnamectl`/`systemctl start`
# calls, so the image sets its hostname through pi-gen's own mechanism and
# enables `avahi-daemon` directly instead). It never calls `setup_tls` at
# build time — a public image is downloaded by everybody, so a certificate
# baked into it would be a private key every install shared; the image's own
# first-boot service calls `setup_tls` itself, once, on real hardware.

set -euo pipefail

INSTALL_DIR="/opt/trustytrack"
DATA_DIR="/var/lib/trustytrack"
CONF_DIR="/etc/trustytrack"
SERVICE_USER="trustytrack"
REPO_URL="https://github.com/dknowles2/trusty-track.git"

# TRUSTYTRACK_HTTP_ONLY
# (docs/reference/roles-and-permissions.md#https-certificates-and-plain-http):
# skip certificate generation and serve plain HTTP instead. `sudo` drops the caller's
# environment by default, so setting this means running the script as
# `sudo TRUSTYTRACK_HTTP_ONLY=1 ./scripts/install-pi.sh` (or `sudo -E`), not
# `export`ing it beforehand.
#
# Lower-cased with `tr`, not bash 4's `${var,,}` — this script is also
# sourced and exercised by the test suite under whatever `bash` a
# contributor's machine resolves to, which on a stock Mac with no Homebrew
# bash is 3.2 at /bin/bash; 3.2 rejects `${var,,}` with "bad substitution"
# (dknowles2/trusty-track#891). `case` rather than `[[ =~ ]]`, so there is no
# regex-quoting question to get wrong on top of it.
http_only_raw="${TRUSTYTRACK_HTTP_ONLY:-}"
case "$(printf '%s' "$http_only_raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
        HTTP_ONLY=true
        SCHEME="http"
        ;;
    *)
        HTTP_ONLY=false
        SCHEME="https"
        ;;
esac

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

    install_node
}

# ---------------------------------------------------------------------------
# 1b. Node.js
# ---------------------------------------------------------------------------
#
# 22 is the floor we accept; 24 is what we install and what `.nvmrc`, CI and
# the Docker image use. An existing >=22 is left alone rather than replaced —
# this runs on a Pi that may be doing other things.
#
# Also requires `npm` on PATH, not just `node` — Debian bookworm's own
# `nodejs` package does not pull `npm` in (it is a separate "Suggested"
# package, not a dependency: `apt-get install nodejs` alone lands a `node`
# with no `npm` at all) — so a Node with no `npm` must fall into the install
# branch below rather than being reported OK
# (dknowles2/trusty-track#1322).
node_is_ok() {
    command -v node &>/dev/null || return 1
    command -v npm &>/dev/null || return 1
    local node_major
    node_major=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    [[ "$node_major" -ge 22 ]]
}

install_node() {
    if node_is_ok; then
        success "Node.js $(node -v) OK"
        return
    fi

    info "Installing Node.js 24 from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -

    # NodeSource's setup script can print its own apt failure — e.g.
    # "Error: Failed to run 'apt update' (Exit Code: 0)", which is what the
    # v1.5.0 Pi image build hit under QEMU emulation, apparently out of
    # memory — and still exit 0: the pipeline's status above is `bash -`'s
    # own, which is 0 whether or not the script it ran actually succeeded,
    # and `set -o pipefail` (already on, line 26) cannot see past that —
    # `bash -` really did exit 0. So check what the script was actually
    # supposed to have done, rather than trusting its exit code: register
    # its apt source. If that file never appeared, the repository never
    # registered, and the plain `apt-get install` below would silently pull
    # Debian's own (npm-less) nodejs instead of NodeSource's — exactly what
    # happened building that image (dknowles2/trusty-track#1322).
    #
    # Overridable so tests can point this at a path they control rather
    # than `/etc`; the default is NodeSource's real one (confirmed by
    # reading `setup_24.x`'s own source — it writes the newer deb822-format
    # `nodesource.sources`, not the older `nodesource.list` it explicitly
    # removes on the way in).
    local sources_file="${NODESOURCE_SOURCES_FILE:-/etc/apt/sources.list.d/nodesource.sources}"
    if [[ ! -s "$sources_file" ]]; then
        error "NodeSource did not register — look for an apt error above, e.g. 'Cannot allocate memory' under emulation ($sources_file was not written)"
    fi

    apt-get install -y -q nodejs

    # Re-run the exact same check after the install, rather than trusting
    # apt-get's own exit code: NodeSource registering correctly and
    # apt-get still landing Debian's own nodejs (a pin-priority problem, a
    # partially updated package list, ...) is a different failure from the
    # one above, and both must be caught before ever printing "OK".
    if ! node_is_ok; then
        if command -v node &>/dev/null; then
            local npm_status="missing"
            command -v npm &>/dev/null && npm_status="present"
            error "Node.js is still $(node -v) after installing from NodeSource, and npm is $npm_status — the NodeSource repository did not take effect"
        else
            error "node is not on PATH after installing from NodeSource"
        fi
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
    "$INSTALL_DIR/backend/venv/bin/pip" install --quiet "$INSTALL_DIR"
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
    if [[ "$HTTP_ONLY" == "true" ]]; then
        info "TRUSTYTRACK_HTTP_ONLY is set — skipping certificate generation"
        return
    fi

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
    if [[ "$HTTP_ONLY" == "true" ]]; then
        # Persisted here, not just used during install: the systemd service
        # reads this file (`EnvironmentFile=-/etc/trustytrack/env`) on every
        # start, including after a reboot, whereas the flag on the install
        # command line only exists for this one run.
        echo "TRUSTYTRACK_HTTP_ONLY=1" >> "$CONF_DIR/env"
    fi
    success "Environment file written to $CONF_DIR/env"
}

# ---------------------------------------------------------------------------
# 8. Install and enable systemd service
# ---------------------------------------------------------------------------
#
# Split into "enable" and "start" rather than one function, because the
# pi-gen image build needs the first half only: `systemctl enable` writes the
# `multi-user.target.wants/` symlink straight to disk and has worked inside a
# `chroot` with no running init since long before this project existed (it is
# what every pi-gen image's own `regenerate_ssh_host_keys` enablement already
# relies on) — but `restart` needs a real systemd to talk to, which a chroot
# does not have. A live install still gets the exact same net effect, since
# `main` below calls both in the same order this used to run them in.
install_service() {
    # Belt and braces: git preserves this file's executable bit, but the
    # unit's ExecStart depends on it, and a lost bit would otherwise show up
    # as "permission denied" three steps later in `journalctl`.
    chmod +x "$INSTALL_DIR/scripts/pi-start.sh"

    # Write the service unit from the bundled file if available, else inline it
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$SCRIPT_DIR/trustytrack.service" ]]; then
        cp "$SCRIPT_DIR/trustytrack.service" /etc/systemd/system/trustytrack.service
    else
        cat > /etc/systemd/system/trustytrack.service <<'SERVICE'
[Unit]
Description=Trusty Track Race Management
Wants=avahi-daemon.service
After=network.target avahi-daemon.service trustytrack-firstboot.service

[Service]
Type=simple
User=trustytrack
WorkingDirectory=/opt/trustytrack
EnvironmentFile=-/etc/trustytrack/env
ExecStart=/opt/trustytrack/scripts/pi-start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
    fi

    systemctl enable trustytrack
    success "Trusty Track service enabled"
}

start_service() {
    systemctl daemon-reload
    systemctl restart trustytrack
    success "Trusty Track service started"
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
    # Lower-cased with `tr`, not bash 4's `${var,,}` — see the note above
    # `TRUSTYTRACK_HTTP_ONLY`'s own parsing (dknowles2/trusty-track#891).
    case "$(printf '%s' "$HOTSPOT" | tr '[:upper:]' '[:lower:]')" in
        y) ;;
        *) return ;;
    esac

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

    success "Hotspot configured — connect to 'TrustyTrack' Wi-Fi, then open $SCHEME://trustytrack.local:8000"
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
    start_service
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
    echo "  $SCHEME://$PI_IP:8000         (by IP address)"
    echo "  $SCHEME://trustytrack.local:8000   (mDNS — from any device on the network)"
    echo
    if [[ "$HTTP_ONLY" == "true" ]]; then
        echo "Note: TRUSTYTRACK_HTTP_ONLY is set, so this is plain HTTP — no"
        echo "certificate warning, but the camera and check-in scanner only work"
        echo "on the Pi itself. See docs/reference/roles-and-permissions.md."
    else
        echo "Note: Your browser will warn about the self-signed certificate."
        echo "Click 'Advanced' → 'Proceed to trustytrack.local (unsafe)' to continue."
    fi
    echo
    echo "To check the service status:  sudo systemctl status trustytrack"
    echo "To view logs:                 sudo journalctl -u trustytrack -f"
    echo

    # Print QR code if qrencode is available
    if command -v qrencode &>/dev/null; then
        echo "Scan to open on your phone:"
        qrencode -t ansiutf8 "$SCHEME://$PI_IP:8000"
    fi
}

# Run only when executed, not when sourced. `(return 0 2>/dev/null)` succeeds
# exactly when a `return` is legal here — i.e. we are inside a `source` — and
# fails for every way this script is actually run standalone: `./install-pi.sh`,
# `bash install-pi.sh`, and `curl -fsSL ... | bash` (where there is no source
# file at all, so a `${BASH_SOURCE[0]} == ${0}` check would wrongly say
# "sourced" and never call `main`).
if ! (return 0 2>/dev/null); then
    main "$@"
fi
