#!/usr/bin/env bash
#
# Boot a built Raspberry Pi image under QEMU and poll /health until it
# answers as the version this build just produced
# (dknowles2/trusty-track#724, stage 2).
#
# Usage: qemu-boot-smoke-test.sh <path-to-image.img|image.img.xz> [expected-version]
#
# Needs root (loop devices, the same requirement verify-image.sh already
# has) and `qemu-system-aarch64` on PATH (Debian/Ubuntu:
# apt-get install qemu-system-arm, which despite the name provides both the
# 32- and 64-bit ARM system emulators).
#
# What this proves, and what it does not
# ----------------------------------------
# It boots the *actual* built image — not a rebuild, not the pi-gen chroot —
# under an emulated aarch64 CPU, and it does not stop at "the HTTP server
# answered": it checks the answer names the exact version this build just
# produced. That is the same trick deploy-demo.yml already uses against a
# Cloud Run revision that can otherwise serve traffic while quietly pinned to
# a stale one (see CLAUDE.md's ops.md, "A deploy moves traffic only while...").
# The equivalent mistake here would be an image built from the wrong ref, or
# one where 00-copy-source's version stamp silently didn't take — either way
# the server would still answer *something*, and only checking the version
# catches it.
#
# It proves nothing about real Pi hardware. Boot firmware, GPIO, USB serial
# timers, the touchscreen and SD card behaviour are all completely untouched
# by a generic QEMU `virt` machine, which shares no silicon with a real Pi.
# The image ships smoke-tested, not hardware-tested — the same footing this
# project already states plainly for the DerbyNet timer profiles (CLAUDE.md,
# "Timer integration") rather than implying support.
#
# How this boots a Raspberry Pi OS image with no Raspberry Pi
# --------------------------------------------------------------
# QEMU's `virt` machine is a generic aarch64 board with its own synthesised
# device tree — nothing Broadcom about it — so the two hardware-specific
# halves of a Pi boot are swapped out rather than emulated:
#
#   - Storage: the *whole* raw image (not just the root partition, unlike
#     verify-image.sh) is handed to the guest as a virtio-blk device, so the
#     guest sees the same partition table and the same PARTUUIDs already
#     baked into /etc/fstab. It comes up as /dev/vda1 (boot) and /dev/vda2
#     (root) — same disk, different transport.
#   - Boot path: a real Pi's firmware reads config.txt/cmdline.txt itself;
#     QEMU has no such firmware. `-kernel`/`-append` load the arm64 kernel
#     straight out of the boot partition (kernel8.img, extracted below) and
#     supply the kernel command line directly, so cmdline.txt's own contents
#     (Pi-firmware-only concerns like which serial device is "serial0") are
#     never consulted at all.
#   - Console: PL011 (`ttyAMA0`), the ARM-standard UART `virt` provides, not
#     the Broadcom mini-UART a real Pi has to be told about via a device
#     tree overlay.
#
# The Raspberry Pi kernel carries VIRTIO_BLK, VIRTIO_NET and
# SERIAL_AMBA_PL011 built directly into kernel8.img rather than as loadable
# modules, which is what makes this work with no initramfs and no
# Pi-specific device tree at all — Raspberry Pi OS ships neither.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
	echo "usage: $0 <path-to-image.img|image.img.xz> [expected-version]" >&2
	exit 2
fi

IMAGE_PATH="$1"
EXPECTED_VERSION="${2:-}"

if [[ ! -f "$IMAGE_PATH" ]]; then
	echo "qemu-boot-smoke-test.sh: $IMAGE_PATH not found" >&2
	exit 2
fi

if ! command -v qemu-system-aarch64 >/dev/null 2>&1; then
	echo "qemu-system-aarch64 is required (Debian/Ubuntu: apt-get install qemu-system-arm)" >&2
	exit 1
fi

# Generous on purpose: this runs under TCG (no nested KVM on a hosted
# runner), and first boot also generates a 4096-bit RSA TLS certificate
# (scripts/pi-firstboot.sh) on an emulated CPU with no hardware RNG.
BOOT_TIMEOUT_SECONDS="${BOOT_TIMEOUT_SECONDS:-900}"
QEMU_MEMORY_MB="${QEMU_MEMORY_MB:-1024}"
HOST_HEALTH_PORT="${HOST_HEALTH_PORT:-18443}"

WORK=$(mktemp -d)
LOOP_DEV=""
BOOT_MOUNT="$WORK/boot"
QEMU_PID=""
SERIAL_LOG="$WORK/serial.log"
: >"$SERIAL_LOG"

cleanup() {
	if [[ -n "$QEMU_PID" ]] && kill -0 "$QEMU_PID" 2>/dev/null; then
		kill "$QEMU_PID" 2>/dev/null || true
		wait "$QEMU_PID" 2>/dev/null || true
	fi
	if [[ -d "$BOOT_MOUNT" ]] && mountpoint -q "$BOOT_MOUNT" 2>/dev/null; then
		umount "$BOOT_MOUNT" || true
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
	echo "qemu-boot-smoke-test.sh: decompressing..."
	RAW_IMAGE="$WORK/image.img"
	unxz -k -c "$IMAGE_PATH" >"$RAW_IMAGE"
	;;
esac

echo "qemu-boot-smoke-test.sh: extracting the kernel from the boot partition..."
mkdir -p "$BOOT_MOUNT"
LOOP_DEV=$(losetup -f --show -P "$RAW_IMAGE")
BOOT_PART="${LOOP_DEV}p1"
if [[ ! -b "$BOOT_PART" ]]; then
	echo "FAIL: expected a boot partition at $BOOT_PART" >&2
	exit 1
fi
mount -o ro "$BOOT_PART" "$BOOT_MOUNT"
KERNEL="$WORK/kernel8.img"
cp "$BOOT_MOUNT/kernel8.img" "$KERNEL"
umount "$BOOT_MOUNT"
losetup -d "$LOOP_DEV"
LOOP_DEV=""

# The disk is handed to the guest whole, so root=/dev/vda2 is that same
# disk's own second partition — same PARTUUID /etc/fstab already names,
# just a different transport getting it there. This command line is QEMU's
# own boot path and has nothing to do with cmdline.txt on the boot
# partition; see the header comment.
CMDLINE="console=ttyAMA0,115200 root=/dev/vda2 rootfstype=ext4 rw rootwait fsck.repair=yes"

echo "qemu-boot-smoke-test.sh: booting under QEMU (this can take several minutes under emulation)..."
qemu-system-aarch64 \
	-M virt \
	-cpu cortex-a72 \
	-smp 2 \
	-m "$QEMU_MEMORY_MB" \
	-kernel "$KERNEL" \
	-append "$CMDLINE" \
	-drive "file=${RAW_IMAGE},if=none,format=raw,id=hd0" \
	-device virtio-blk-device,drive=hd0 \
	-netdev "user,id=net0,hostfwd=tcp::${HOST_HEALTH_PORT}-:8000" \
	-device virtio-net-device,netdev=net0 \
	-display none \
	-monitor none \
	-serial "file:${SERIAL_LOG}" \
	-no-reboot \
	&
QEMU_PID=$!

echo "qemu-boot-smoke-test.sh: polling https://127.0.0.1:${HOST_HEALTH_PORT}/health (up to ${BOOT_TIMEOUT_SECONDS}s)..."
BODY=""
DEADLINE=$((SECONDS + BOOT_TIMEOUT_SECONDS))
while [[ "$SECONDS" -lt "$DEADLINE" ]]; do
	if ! kill -0 "$QEMU_PID" 2>/dev/null; then
		echo "FAIL: qemu exited before the image ever answered" >&2
		echo "--- serial console (tail) ---" >&2
		tail -n 200 "$SERIAL_LOG" >&2 || true
		exit 1
	fi
	if BODY=$(curl -fsSk --max-time 3 "https://127.0.0.1:${HOST_HEALTH_PORT}/health" 2>/dev/null); then
		break
	fi
	BODY=""
	sleep 5
done

if [[ -z "$BODY" ]]; then
	echo "FAIL: the image never answered /health within ${BOOT_TIMEOUT_SECONDS}s" >&2
	echo "--- serial console (tail) ---" >&2
	tail -n 200 "$SERIAL_LOG" >&2 || true
	exit 1
fi

echo "qemu-boot-smoke-test.sh: $BODY"

if [[ -n "$EXPECTED_VERSION" ]]; then
	SERVING=$(printf '%s' "$BODY" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
	if [[ "$SERVING" != "$EXPECTED_VERSION" ]]; then
		echo "FAIL: the image answered as version [$SERVING], not the [$EXPECTED_VERSION] it was built as" >&2
		echo "--- serial console (tail) ---" >&2
		tail -n 200 "$SERIAL_LOG" >&2 || true
		exit 1
	fi
	echo "qemu-boot-smoke-test.sh: confirmed version $SERVING"
else
	echo "qemu-boot-smoke-test.sh: no expected version given; checked only that the image answered."
fi

echo "qemu-boot-smoke-test.sh: OK"
