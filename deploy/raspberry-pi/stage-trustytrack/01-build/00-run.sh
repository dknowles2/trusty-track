#!/bin/bash -e
# Builds the app inside the target chroot, reusing install-pi.sh's own
# functions rather than a second copy of "how to build Trusty Track":
#
#   - install_system_packages installs Python, Node (from NodeSource, exactly
#     as a live Pi install does) and the handful of system packages both
#     paths need. It also installs `git` and `python3-pip`, neither of which
#     this image actually needs (there is no `git clone` here — the source
#     already arrived via rsync in 00-copy-source — and a venv's own pip
#     comes from `python3-venv`'s bundled `ensurepip`, not the system
#     package). They are removed in 03-cleanup rather than skipped here: the
#     alternative is a second, hand-picked package list that has to be kept
#     in step with install-pi.sh's by a person remembering, which is exactly
#     the failure mode #48 names throughout this project.
#   - build_app creates the venv, `pip install`s the app into it, and runs
#     `npm ci && npm run build`. This is the slow step — real compilation and
#     package downloads under QEMU emulation — which is why it is its own
#     numbered stage: a failure in a later stage (03-cleanup, 04-verify) can
#     be fixed and the build resumed with `CONTINUE=1` without redoing this.
#
# Runs under QEMU (pi-gen's `on_chroot`), so "building the venv" here means
# building it *for arm64* — unlike the Dockerfile's frontend stage, which is
# deliberately pinned to the host platform because its output is
# architecture-independent JavaScript. There is no equivalent shortcut for
# the Python side: Pillow and pillow-heif ship compiled extensions, and they
# have to be the arm64 build that will actually run on the Pi.
on_chroot << 'EOF'
set -euo pipefail
source /opt/trustytrack/scripts/install-pi.sh
install_system_packages
build_app
EOF
