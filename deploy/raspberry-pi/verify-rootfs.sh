#!/usr/bin/env bash
# Test layer B, the assertions half: checks a Raspberry Pi rootfs actually
# contains a working Trusty Track install, without booting it.
#
# Deliberately pure filesystem checks over an already-available directory —
# no mounting, no loop devices, nothing that needs root. verify-image.sh (the
# other half of layer B) is the thin wrapper that gets a real .img's root
# partition mounted and hands this script the directory; a synthetic
# directory tree with the same handful of marker files works exactly as well,
# which is what backend/tests/test_pi_image_layer_b.py builds to exercise
# this script with no image, no mount and no root privileges at all.
#
# Usage: verify-rootfs.sh <rootfs-dir>
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: $0 <rootfs-dir>" >&2
	exit 2
fi

ROOTFS="$1"
FAILURES=0

fail() {
	echo "FAIL: $*" >&2
	FAILURES=$((FAILURES + 1))
}

ok() {
	echo "ok: $*"
}

check_file() {
	local path="$1" desc="$2"
	if [[ -f "$ROOTFS$path" ]]; then
		ok "$desc"
	else
		fail "$desc ($path not found)"
	fi
}

check_executable() {
	local path="$1" desc="$2"
	if [[ -f "$ROOTFS$path" && -x "$ROOTFS$path" ]]; then
		ok "$desc"
	else
		fail "$desc ($path missing or not executable)"
	fi
}

# The unit file existing is not the same claim as the unit being *enabled* —
# see CLAUDE.md's own note on this under #724's stage 1: the most likely
# pi-gen failure is an image that builds "successfully" while missing the
# application, and a unit file present but never enabled is exactly that
# shape of failure, silently.
check_enabled() {
	local unit="$1"
	local symlink="$ROOTFS/etc/systemd/system/multi-user.target.wants/$unit"
	if [[ -L "$symlink" ]]; then
		ok "$unit is enabled (multi-user.target.wants/$unit is a symlink)"
	else
		fail "$unit is not enabled (no multi-user.target.wants/$unit symlink)"
	fi
}

# The inverse check that matters most: a rootfs that ships the build
# toolchain it promised to strip. Checked two ways — PATH-visible binaries,
# and dpkg's own package database when one is present (a synthetic test
# tree built by test_pi_image_layer_b.py has no dpkg database at all, so
# that half is skipped rather than failed when the file is absent).
check_absent_from_path() {
	local tool="$1"
	local hit=""
	for bindir in /usr/bin /usr/local/bin /bin /usr/sbin /sbin; do
		if [[ -e "$ROOTFS$bindir/$tool" ]]; then
			hit="$bindir/$tool"
			break
		fi
	done
	if [[ -n "$hit" ]]; then
		fail "$tool is still present at $hit"
	else
		ok "$tool is absent from the usual PATH directories"
	fi
}

check_absent_from_dpkg() {
	local pkg="$1"
	local status_file="$ROOTFS/var/lib/dpkg/status"
	if [[ ! -f "$status_file" ]]; then
		# No dpkg database at all — a synthetic test tree, not a real image.
		return
	fi
	if awk -v pkg="$pkg" '
		/^Package: / { current = ($2 == pkg) }
		current && /^Status: .*installed/ { found = 1 }
		END { exit !found }
	' "$status_file"; then
		fail "$pkg is still recorded as installed in dpkg's status file"
	else
		ok "$pkg is not recorded as installed in dpkg's status file"
	fi
}

echo "== The app is actually in there =="
check_file /opt/trustytrack/frontend/dist/index.html "frontend build is present"
check_executable /opt/trustytrack/backend/venv/bin/python3 "venv's python3 is present and executable"
check_executable /opt/trustytrack/backend/venv/bin/uvicorn "venv's uvicorn is present and executable"
check_executable /opt/trustytrack/scripts/pi-start.sh "pi-start.sh is present and executable"
check_file /etc/systemd/system/trustytrack.service "trustytrack.service unit file is present"
check_enabled trustytrack.service
check_file /etc/systemd/system/trustytrack-firstboot.service "trustytrack-firstboot.service unit file is present"
check_enabled trustytrack-firstboot.service

echo "== The build toolchain did not survive =="
for tool in node npm git; do
	check_absent_from_path "$tool"
done
check_absent_from_dpkg nodejs
check_absent_from_dpkg npm
check_absent_from_dpkg git

echo
if [[ "$FAILURES" -gt 0 ]]; then
	echo "verify-rootfs.sh: $FAILURES check(s) failed" >&2
	exit 1
fi
echo "verify-rootfs.sh: all checks passed"
