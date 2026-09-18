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
#
# `docs/` is anchored with a leading slash, unlike the rest of this list —
# rsync matches an unanchored pattern against every path component, not just
# the source root the way a bare `.dockerignore` entry does, and this repo
# has two more directories literally named `docs`: `frontend/src/docs/`
# (real application source — `docsLink.ts`, the module every "Learn more"
# link resolves through) and `frontend/e2e/docs/`. An unanchored
# `--exclude='docs/'` silently dropped both, and the frontend build failed
# with `docsLink.ts` missing (dknowles2/trusty-track#1234) — the mkdocs site
# this line means to exclude only ever lives at the repository root.
#
# `.venv/`, `/dist/` and `*.egg-info/` are anchored the same way, and cover a
# different gap: `build.sh` bind-mounts a real working tree, not a fresh
# clone (see the header above), so a maintainer who has run `uv sync` (the
# venv every command in this repo's own docs assumes) or `uv build` before
# building the image locally would otherwise rsync a several-hundred-MB dev
# venv and a stray wheel into `/opt/trustytrack`. `backend/venv/` above only
# covers the *target*-machine path `install-pi.sh`'s own build creates
# (`$INSTALL_DIR/backend/venv`) — a different directory — so it never caught
# this. Harmless today (nothing at `/opt/trustytrack/.venv` is ever run;
# `install_python_deps` builds its own `backend/venv` regardless) but pure
# bloat, and invisible in CI, where `actions/checkout` always starts from a
# tree with no `.venv`/`dist`/`egg-info` present to exclude in the first
# place — the same "a sandbox can't see it, a real run does" shape as the
# `docs/` bug just above (dknowles2/trusty-track#1236's review).
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
	--exclude='/docs/' \
	--exclude='uploads/' \
	--exclude='/.venv/' \
	--exclude='/dist/' \
	--exclude='*.egg-info/' \
	/trustytrack-src/ "${ROOTFS_DIR}/opt/trustytrack/"

# The same "Set version in version.py" step release.yml runs before every
# other release artefact (Docker, macOS, Windows) — see build.sh's own
# comment on TRUSTYTRACK_VERSION. Applied to the copy inside the image, never
# to the bind-mounted /trustytrack-src, which build.sh mounts read-only.
if [ -n "${TRUSTYTRACK_VERSION:-}" ]; then
	echo "__version__ = \"${TRUSTYTRACK_VERSION}\"" > "${ROOTFS_DIR}/opt/trustytrack/backend/version.py"
fi
