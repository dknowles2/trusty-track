#!/usr/bin/env bash
# Test layer B, the real-image half: loop-mounts a finished .img (or
# .img.xz) and hands its root partition to verify-rootfs.sh — the same
# checks, run against the actual artefact rather than the chroot it was
# built in. This is what catches a pi-gen step that ran cleanly but wrote
# its output somewhere the export step didn't carry into the image, which
# 04-verify (layer A, inside the chroot) cannot see by construction.
#
# Needs root (loop devices), a privileged environment or sudo — the same
# requirement pi-gen's own build already has. Not run as part of the normal
# test suite for that reason; backend/tests/test_pi_image_layer_b.py
# exercises verify-rootfs.sh directly instead, against a synthetic directory
# tree, which is the "stubbed mount" the checks below do not need.
#
# Usage: verify-image.sh <path-to-image.img|image.img.xz>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ne 1 ]]; then
	echo "usage: $0 <path-to-image.img|image.img.xz>" >&2
	exit 2
fi

IMAGE_PATH="$1"
if [[ ! -f "$IMAGE_PATH" ]]; then
	echo "verify-image.sh: $IMAGE_PATH not found" >&2
	exit 2
fi

# GitHub caps a release asset at 2 GiB (see the top-level issue's "Check the
# size before promising anything") — checked against the file actually
# destined to be uploaded, whichever form that is.
MAX_RELEASE_ASSET_BYTES=$((2 * 1024 * 1024 * 1024))
ASSET_SIZE=$(stat -c%s "$IMAGE_PATH" 2>/dev/null || stat -f%z "$IMAGE_PATH")
echo "verify-image.sh: $IMAGE_PATH is $ASSET_SIZE bytes"
if [[ "$ASSET_SIZE" -gt "$MAX_RELEASE_ASSET_BYTES" ]]; then
	echo "FAIL: $IMAGE_PATH exceeds GitHub's 2 GiB release asset limit" >&2
	exit 1
fi

WORK=$(mktemp -d)
LOOP_DEV=""
MOUNT_DIR="$WORK/root"

cleanup() {
	if [[ -d "$MOUNT_DIR" ]] && mountpoint -q "$MOUNT_DIR" 2>/dev/null; then
		umount "$MOUNT_DIR" || true
	fi
	if [[ -n "$LOOP_DEV" ]]; then
		losetup -d "$LOOP_DEV" || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

RAW_IMAGE="$IMAGE_PATH"
case "$IMAGE_PATH" in
*.xz)
	echo "verify-image.sh: decompressing..."
	RAW_IMAGE="$WORK/image.img"
	unxz -k -c "$IMAGE_PATH" > "$RAW_IMAGE"
	;;
esac

RAW_SIZE=$(stat -c%s "$RAW_IMAGE" 2>/dev/null || stat -f%z "$RAW_IMAGE")
echo "verify-image.sh: decompressed image is $RAW_SIZE bytes"
# A sane range, not a precise one: Pi OS Lite alone is a few hundred
# megabytes, and this image adds a venv and a frontend build with no desktop
# or browser (that is kiosk-mode territory, out of this stage's scope) — a
# few gigabytes at the very outside. Anything under 300 MB is almost
# certainly a build that silently produced nothing.
MIN_SANE_BYTES=$((300 * 1024 * 1024))
MAX_SANE_BYTES=$((4 * 1024 * 1024 * 1024))
if [[ "$RAW_SIZE" -lt "$MIN_SANE_BYTES" || "$RAW_SIZE" -gt "$MAX_SANE_BYTES" ]]; then
	echo "FAIL: decompressed image size ($RAW_SIZE bytes) is outside the sane range" >&2
	exit 1
fi

mkdir -p "$MOUNT_DIR"
LOOP_DEV=$(losetup -f --show -P "$RAW_IMAGE")
echo "verify-image.sh: attached as $LOOP_DEV"

# Raspberry Pi OS images are two partitions: a small FAT boot partition
# (p1) and the ext4 root filesystem (p2). Everything verify-rootfs.sh checks
# lives on the root partition.
ROOT_PART="${LOOP_DEV}p2"
if [[ ! -b "$ROOT_PART" ]]; then
	echo "FAIL: expected a root partition at $ROOT_PART" >&2
	exit 1
fi

mount -o ro "$ROOT_PART" "$MOUNT_DIR"

"$HERE/verify-rootfs.sh" "$MOUNT_DIR"
