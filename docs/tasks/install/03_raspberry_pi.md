# Install Channel 3: Raspberry Pi (Appliance Mode) [COMPLETED]

> **Built.** `scripts/install-pi.sh`, `scripts/trustytrack.service`, and
> `docs/user/install-raspberry-pi.md`.

## Audience

Users who want to dedicate a Raspberry Pi (or similar single-board computer)
as a permanent, plug-in-and-go Trusty Track appliance. Typical scenario:

> The pack buys a Raspberry Pi 4, sets it up at home the week before the race,
> and on race day they plug it into the venue's network (or use it as a
> hotspot). Families connect from phones and laptops via the local network.
> The operator opens a browser on the Pi's touchscreen or a laptop.

**Goal:** After a one-time install, the Pi boots directly into Trusty Track
with no terminal interaction required on race day.

---

## Target Hardware

- **Primary:** Raspberry Pi 4 (2 GB RAM or more) or Raspberry Pi 5
- **Secondary:** Raspberry Pi 3B+ (1 GB RAM — acceptable but slow builds)
- **OS:** Raspberry Pi OS Lite (64-bit, Bookworm / Debian 12)
- **Optional:** 7" official touchscreen for a self-contained kiosk

---

## Prerequisite

Unified server mode (task `01_from_source.md §1.1`) must be implemented so a
single process serves the full application.

---

## Engineering Tasks

### 3.1 — Install Script (`scripts/install-pi.sh`)

A single bash script that transforms a fresh Raspberry Pi OS install into a
running Trusty Track appliance.

**Steps performed:**

1. **System packages**
   ```bash
   sudo apt-get update
   sudo apt-get install -y python3 python3-pip python3-venv nodejs npm git curl
   ```
   Verify minimum versions: Python ≥ 3.10, Node ≥ 22. If Node 22 is not
   available from the default repo, install it from NodeSource.

2. **Clone the repo** (or download a release tarball if not running from source)
   ```bash
   git clone https://github.com/org/trustytrack.git /opt/trustytrack
   ```

3. **Build the frontend**
   ```bash
   cd /opt/trustytrack/frontend
   npm ci
   npm run build
   ```

4. **Install Python dependencies**
   ```bash
   cd /opt/trustytrack/backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r pyproject.toml
   ```

5. **Create the data directory**
   ```bash
   mkdir -p /var/lib/trustytrack
   chown trustytrack:trustytrack /var/lib/trustytrack
   ```

6. **Create a system user**
   ```bash
   sudo useradd --system --home /opt/trustytrack --shell /usr/sbin/nologin trustytrack
   ```

7. **Generate a self-signed TLS certificate** (required for camera access)
   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout /etc/trustytrack/key.pem \
     -out /etc/trustytrack/cert.pem -days 3650 -nodes \
     -subj "/CN=trustytrack.local"
   ```

8. **Install the systemd service** (see §3.2 below).

9. **Enable and start the service**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable trustytrack
   sudo systemctl start trustytrack
   ```

10. **Print the access URL** and QR code (if `qrencode` is available).

**Usage:**
```bash
curl -fsSL https://get.trustytrack.app/install.sh | bash
# or from the cloned repo:
./scripts/install-pi.sh
```

---

### 3.2 — systemd Service Unit (`scripts/trustytrack.service`)

```ini
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
```

`/etc/trustytrack/env` holds environment overrides:
```
TRUSTYTRACK_DATA_DIR=/var/lib/trustytrack
```

---

### 3.3 — mDNS / Hostname (Optional but Recommended)

Configure `avahi-daemon` so the Pi is reachable at `trustytrack.local` from
any device on the same network without knowing the IP address.

```bash
sudo apt-get install -y avahi-daemon
sudo hostnamectl set-hostname trustytrack
```

Users can then navigate to `https://trustytrack.local:8000` from any laptop
or phone on the same Wi-Fi.

---

### 3.4 — Wi-Fi Hotspot Mode (Optional)

For venues without reliable Wi-Fi, the Pi can act as its own access point.

Steps:
- Install `hostapd` and `dnsmasq`.
- Configure a static IP on `wlan0` (`192.168.73.1`).
- `dnsmasq` provides DHCP and resolves `trustytrack.local` to `192.168.73.1`.
- `hostapd` broadcasts an SSID (e.g. `TrustyTrack`).

This is an optional, advanced step. The install script should offer it as an
opt-in prompt:
```
Set up Wi-Fi hotspot mode? (recommended for venues without Wi-Fi) [y/N]
```

---

### 3.5 — Kiosk Browser (Optional)

If the Pi has a display attached, it can launch Chromium in kiosk mode to
show the Trusty Track UI full-screen on boot.

Add a systemd user service (or autostart entry) that runs:
```bash
chromium-browser --kiosk --noerrdialogs \
  https://localhost:8000 \
  --ignore-certificate-errors
```

The `--ignore-certificate-errors` flag is acceptable here because the cert is
self-signed on localhost; this is not suitable for internet-facing deployments.

---

### 3.6 — Pre-Built SD Card Image (Future / Aspirational)

For the "needs handholding" experience, a pre-built SD card image eliminates
the install script entirely. The user:
1. Downloads a `.img.gz` file.
2. Flashes it to an SD card with Raspberry Pi Imager.
3. Boots the Pi — Trusty Track starts automatically.

This requires:
- Building a custom image using **pi-gen** (the official Raspberry Pi OS
  build tool).
- The image would be a minimal Raspberry Pi OS Lite with Trusty Track
  pre-installed and the systemd service enabled.
- The pi-gen customization script would run the install steps from §3.1.
- The image must be re-built for each release (automated in §05).

**This is a future task.** The install script (§3.1) is the deliverable for
the initial release. The SD card image can be added once the install script
is stable.

---

## User Documentation Required

- `docs/user/install-raspberry-pi.md` — End-user guide.
  - What hardware to buy (Pi model, SD card, power supply, optional screen).
  - How to flash Raspberry Pi OS Lite.
  - How to run the install script (SSH into the Pi, paste one command).
  - How to connect from phones and laptops (including accepting the
    self-signed certificate warning).
  - How to set up hotspot mode (optional section).
  - How to update Trusty Track.
  - Troubleshooting: service not starting, can't connect from other devices.

See `06_user_documentation.md` for details.

---

## Definition of Done

- [ ] `scripts/install-pi.sh` runs end-to-end on a fresh Raspberry Pi OS
  Lite (64-bit Bookworm) install.
- [ ] `systemctl status trustytrack` shows `active (running)` after install.
- [ ] App is reachable at `https://<pi-ip>:8000` from another device on the
  same network.
- [ ] App is reachable at `https://trustytrack.local:8000` (mDNS).
- [ ] Service restarts automatically if the process crashes.
- [ ] Service starts automatically on reboot.
- [ ] Data persists across reboots (stored in `/var/lib/trustytrack/`).
- [ ] Hotspot mode script is documented (even if not auto-installed).
