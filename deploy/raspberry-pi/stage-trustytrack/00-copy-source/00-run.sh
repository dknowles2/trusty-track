#!/bin/bash -e
# Copies the Trusty Track working tree into the image, at the same path
# `install-pi.sh` uses on a live Pi (`/opt/trustytrack`) — everything below
# this stage that reuses `install-pi.sh`'s functions depends on that path
# agreeing.
#
# Runs on the host side of the stage (the pi-gen container, not yet the
# target chroot), because that is the only place `/trustytrack-src` is
# visible: `deploy/raspberry-pi/build.sh` bind-mounts the repository there
# with `PIGEN_DOCKER_OPTS`, rather than copying it into the pi-gen checkout
# that gets baked into the "pi-gen" builder image itself. A bind mount means
# editing application source and re-running the build costs nothing extra;
# baking it into that image's build context would mean Docker re-layering a
# few hundred megabytes of source on every change.
#
# Unlike a Docker build, there is no separate ".pi-gen-ignore" — the
# exclusions below mirror what the repo's own `.dockerignore` keeps out of
# the container image, in rsync's syntax rather than Docker's, because
# rsync's `--exclude-from` has no equivalent to `.dockerignore`'s
# `!README.md` negation. That one difference is inconsequential here: this
# tree is never served, so whether a stray README ships inside
# `/opt/trustytrack` does not matter the way it would in a container image
# whose build context is also its cache key.
if [ ! -d /trustytrack-src ]; then
	echo "stage-trustytrack: /trustytrack-src is not mounted — see deploy/raspberry-pi/build.sh" >&2
	exit 1
fi

install -d -m 755 "${ROOTFS_DIR}/opt/trustytrack"

rsync -a \
	--exclude='.git/' \
	--exclude='node_modules/' \
	--exclude='frontend/dist/' \
	--exclude='backend/venv/' \
	--exclude='backend/uploads/' \
	--exclude='__pycache__/' \
	--exclude='*.pyc' \
	--exclude='*.db' \
	--exclude='*.db-wal' \
	--exclude='*.db-shm' \
	--exclude='docs/' \
	--exclude='uploads/' \
	/trustytrack-src/ "${ROOTFS_DIR}/opt/trustytrack/"

# The same "Set version in version.py" step release.yml runs before every
# other release artefact (Docker, macOS, Windows) — see build.sh's own
# comment on TRUSTYTRACK_VERSION. Applied to the copy inside the image, never
# to the bind-mounted /trustytrack-src, which build.sh mounts read-only.
if [ -n "${TRUSTYTRACK_VERSION:-}" ]; then
	echo "__version__ = \"${TRUSTYTRACK_VERSION}\"" > "${ROOTFS_DIR}/opt/trustytrack/backend/version.py"
fi
