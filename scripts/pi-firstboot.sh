#!/usr/bin/env bash
# ExecStart for trustytrack-firstboot.service — the pre-built Raspberry Pi
# image's (deploy/raspberry-pi/) one piece of first-boot work: generating the
# self-signed TLS certificate.
#
# This does not exist on a live `install-pi.sh` install, which generates the
# certificate itself, during the install, before the service is ever
# started. The image cannot do that at build time — a public image is
# downloaded by everybody, so a certificate baked into it would be a private
# key every install shared — so it defers the one step that has to happen on
# real hardware to this unit, ordered before `trustytrack.service` by that
# service's own `After=`.
#
# Reuses `setup_tls` from install-pi.sh rather than a second copy of the
# `openssl req` invocation, so there is exactly one place a Trusty Track
# install's certificate is generated, however it got onto the Pi. Sourcing
# is safe: install-pi.sh only calls its own `main` when it is executed
# directly (see the guard at its own end), never when sourced like this.
set -euo pipefail

# shellcheck source=install-pi.sh
source /opt/trustytrack/scripts/install-pi.sh

setup_tls
