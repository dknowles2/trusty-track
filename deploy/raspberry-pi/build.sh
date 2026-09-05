#!/usr/bin/env bash
#
# Build the pre-built Raspberry Pi image (dknowles2/trusty-track#724, stage 1).
#
#   ./deploy/raspberry-pi/build.sh
#       Build the current working tree into an .img.xz. What you want for a
#       local test build.
#
#   TRUSTYTRACK_VERSION=1.2.3 ./deploy/raspberry-pi/build.sh
#       Stamp a release version into the image the same way release.yml
#       stamps it into the Docker, macOS and Windows builds — see the
#       "Set version in version.py" step in .github/workflows/release.yml.
#       Left unset, the image reports "0.0.0-dev-unknown": there is no `git`
#       in the runtime image (see 03-cleanup) for backend/version.py's own
#       fallback to shell out to, which is the same thing every unlabelled
#       Docker build already does, for the same reason.
#
# What this does and does not do
# -------------------------------
# It runs pi-gen (https://github.com/RPi-Distro/pi-gen) against Raspberry Pi
# OS Lite, 64-bit, Bookworm — the exact base scripts/install-pi.sh already
# targets — plus one extra stage of our own, stage-trustytrack/, which bakes
# in a built frontend and an installed venv so the image boots straight into
# a working install with no on-Pi build step. It does *not* wire this into
# release.yml (a QEMU-emulated pi-gen build is tens of minutes even before
# the image is compressed — see the top-level issue's "Why this is
# iceboxed" — and CI wiring is deliberately a later stage of the same issue,
# same as the QEMU boot-and-poll-/health test that would prove the image
# actually starts). Run it by hand, or from a workflow_dispatch, until then.
#
# Why pi-gen runs inside its own Docker container rather than on this
# machine directly
# -------------------------------------------------------------------------
# pi-gen's build-docker.sh needs --privileged (loop devices, bind mounts) and
# a specific set of host tools (`depends` in the pi-gen repo); running it in
# a container it builds for itself is what makes this reproducible on
# anything with Docker and binfmt/QEMU, which is exactly what
# release.yml's existing arm64 Docker job already sets up for the ordinary
# container image — see docker/setup-qemu-action there.
#
# Why the application source is bind-mounted rather than copied into the
# pi-gen checkout
# ----------------------------------------------------------------------
# pi-gen's own Dockerfile does `COPY . /pi-gen/`, so anything the custom
# stage needs has to be reachable from inside that container. Baking the
# whole Trusty Track tree into the "pi-gen" builder image via that COPY
# would mean Docker re-layering a few hundred megabytes on every source
# change; PIGEN_DOCKER_OPTS (a pi-gen mechanism for passing extra `docker
# run` flags) instead bind-mounts this checkout read-only at
# /trustytrack-src, which stage-trustytrack/00-copy-source/00-run.sh rsyncs
# into the image being built. Only the (small) custom stage itself needs to
# physically live inside the pi-gen checkout.
#
# Why pi-gen is a pinned commit fetched fresh rather than a vendored copy
# ------------------------------------------------------------------------
# pi-gen is a build tool, not a dependency this project ships — vendoring it
# would mean carrying (and updating) somebody else's shell scripts and
# Debian package lists in this repository for no benefit over pinning a
# commit and fetching it at build time, the same trust boundary `apt-get`
# and `npm ci` already cross during every build this project does. The
# `arm64` architecture needs pi-gen's own `bookworm-arm64` branch — the
# `master` branch targets 32-bit Raspberry Pi OS and, on current pi-gen,
# `trixie` rather than the Bookworm base scripts/install-pi.sh targets.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

PI_GEN_REPO="${PI_GEN_REPO:-https://github.com/RPi-Distro/pi-gen.git}"
# HEAD of bookworm-arm64 as of 2026-06-15. Pinned for the same reason a
# GitHub Action is pinned to a SHA rather than a floating tag: a build run
# today and a build run next year should produce the same shape of image
# from the same inputs. Bump deliberately, not as a side effect of an
# unrelated change.
PI_GEN_REF="${PI_GEN_REF:-d7a31c6aa09f4b867902c51da2b45807c0a1709e}"

WORK_DIR="${WORK_DIR:-$HERE/.pi-gen-work}"
OUT_DIR="${OUT_DIR:-$HERE/deploy}"

info() { echo "[trustytrack-pi] $*"; }

if ! command -v docker >/dev/null 2>&1; then
	echo "docker is required (pi-gen's build-docker.sh drives the whole build through it)" >&2
	exit 1
fi

info "Fetching pi-gen@${PI_GEN_REF} (bookworm-arm64) into ${WORK_DIR}..."
rm -rf "$WORK_DIR"
git clone --quiet --branch bookworm-arm64 "$PI_GEN_REPO" "$WORK_DIR"
git -C "$WORK_DIR" checkout --quiet "$PI_GEN_REF"

info "Restricting the build to stage0/1/2 (Lite) plus our own stage..."
cp -a "$HERE/stage-trustytrack" "$WORK_DIR/stage-trustytrack"
cp "$HERE/config" "$WORK_DIR/config"
# stage2/EXPORT_IMAGE would otherwise also export a stock Lite image; only
# stage-trustytrack's own EXPORT_IMAGE should fire. This edits the throwaway
# clone, never anything tracked in this repository.
touch "$WORK_DIR/stage2/SKIP_IMAGES"

# Two things pi-gen's own build-docker.sh does not parameterise, and both
# matter the moment a second build runs on the same machine (two worktrees,
# or a local build started while another is mid-flight): the Docker image
# tag it builds ("pi-gen", hardcoded) is unavoidably shared, but the
# container name defaults to a fixed "pigen_work" too, which we *can* make
# per-checkout — the same rule CLAUDE.md documents for the frontend e2e
# suite's ports and data directories, and for the same reason: a fixed name
# is what a worktree-based workflow collides on first.
CHECKOUT_HASH="$(echo -n "$REPO_ROOT" | cksum | cut -d' ' -f1)"
export CONTAINER_NAME="pigen_trustytrack_${CHECKOUT_HASH}"

PIGEN_DOCKER_OPTS="--volume ${REPO_ROOT}:/trustytrack-src:ro"
if [[ -n "${TRUSTYTRACK_VERSION:-}" ]]; then
	PIGEN_DOCKER_OPTS="${PIGEN_DOCKER_OPTS} -e TRUSTYTRACK_VERSION=${TRUSTYTRACK_VERSION}"
fi
export PIGEN_DOCKER_OPTS

info "Building (this runs the whole of stage0/1/2 under QEMU — tens of minutes)..."
cd "$WORK_DIR"
./build-docker.sh -c config

mkdir -p "$OUT_DIR"
cp -v "$WORK_DIR"/deploy/*.img.xz "$OUT_DIR"/ 2>/dev/null || {
	echo "No .img.xz found in ${WORK_DIR}/deploy — see ${WORK_DIR}/deploy/build-docker.log" >&2
	exit 1
}

info "Done. Image(s):"
( cd "$OUT_DIR" && ls -lh -- *.img.xz && sha256sum -- *.img.xz )
