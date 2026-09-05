#!/bin/bash -e
# Everything short of the two things that must wait for real hardware
# (the TLS certificate, and the mDNS hostname's live-system half) — again by
# calling install-pi.sh's own functions rather than duplicating them.
on_chroot << 'EOF'
set -euo pipefail
source /opt/trustytrack/scripts/install-pi.sh

# Creates the trustytrack system user and /var/lib/trustytrack, and hands the
# whole /opt/trustytrack tree to that user — identical to a live install.
setup_user_and_dirs

# Writes /etc/trustytrack/env. No TRUSTYTRACK_HTTP_ONLY is set here, so the
# image defaults to HTTPS with a certificate generated on first boot — the
# same default a fresh `install-pi.sh` run produces.
setup_env

# Installs the systemd unit and runs the "enable" half only (see
# install-pi.sh's own comment on the split): `systemctl enable` writes the
# multi-user.target.wants/ symlink straight to disk, which needs no running
# systemd. There is no chroot equivalent of `start_service` — nothing here
# should be running while the image is being assembled.
install_service

# Installs and enables the first-boot certificate-generation unit
# (scripts/pi-firstboot.sh, scripts/trustytrack-firstboot.service), already
# present at /opt/trustytrack/scripts because 00-copy-source brought the
# whole tree across. trustytrack.service's own `After=` (see
# scripts/trustytrack.service) is what orders it before the app starts.
chmod +x /opt/trustytrack/scripts/pi-firstboot.sh
cp /opt/trustytrack/scripts/trustytrack-firstboot.service /etc/systemd/system/trustytrack-firstboot.service
systemctl enable trustytrack-firstboot.service

# mDNS: the hostname itself is set by pi-gen's own TARGET_HOSTNAME (see
# deploy/raspberry-pi/config) rather than by calling setup_mdns's
# `hostnamectl set-hostname` here, which needs a running systemd-hostnamed to
# talk to over D-Bus — not available in a chroot with no init running.
# Enabling the daemon needs no such thing, so that half is reused directly.
systemctl enable avahi-daemon
EOF
