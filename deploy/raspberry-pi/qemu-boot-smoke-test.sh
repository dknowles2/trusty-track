#!/usr/bin/env bash
#
# Boot a built Raspberry Pi image under QEMU and poll /health until it
# answers as the version this build just produced
# (dknowles2/trusty-track#724, stage 2).
#
# Usage: qemu-boot-smoke-test.sh <path-to-image.img|image.img.xz> [expected-version]
#
# Needs root (loop devices, the same requirement verify-image.sh already
# has) and `qemu-system-aarch64`/`qemu-img` on PATH (Debian/Ubuntu:
# apt-get install qemu-system-arm, which despite the name provides both the
# 32- and 64-bit ARM system emulators and pulls in qemu-utils, which is
# where qemu-img lives).
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
# It proves very little about real Pi hardware. `-M raspi3b` (below) models
# a real Broadcom BCM2837 closely enough that this kernel's own SD and USB
# drivers bind to it, but it is still not the Pi 4 this image actually
# targets, and QEMU's own documentation calls its peripheral model
# incomplete even for what it does implement (no PWM; `-M raspi4b` — not
# used here — additionally lacks PCIe and its GENET Ethernet controller).
# Boot firmware, GPIO, the touchscreen, real USB serial timers and actual SD
# card timing are all untested. The image ships smoke-tested, not
# hardware-tested — the same footing this project already states plainly
# for the DerbyNet timer profiles (CLAUDE.md, "Timer integration") rather
# than implying support.
#
# How this boots a Raspberry Pi OS image with no Raspberry Pi
# --------------------------------------------------------------
# The first real run of this script (dknowles2/trusty-track#1234) found
# that QEMU's generic `virt` machine cannot boot this kernel at all:
# `kernel8.img` (raspberrypi/linux's `bcm2711_defconfig`, the kernel
# `scripts/install-pi.sh`'s own target — Raspberry Pi OS Lite 64-bit,
# Bookworm — actually ships) carries no `CONFIG_VIRTIO_*` support whatsoever,
# not even as a module, so a virtio-blk root device can never appear
# (dknowles2/trusty-track#1235). Worse, `virt`'s PCIe bus (the generic ECAM
# host bridge QEMU calls `gpex`) has no driver in this kernel either —
# `CONFIG_PCI_HOST_GENERIC` is absent, and the only PCIe host bridge driver
# actually built in is `CONFIG_PCIE_BRCMSTB`, which matches only the real
# Broadcom SoC's own PCIe controller, never `virt`'s synthesised one. So
# every PCI-attached alternative (`qemu-xhci`, `e1000`, …) is a dead end on
# `virt` too: the bus a Pi kernel would need a driver for to find them is
# never even probed. `virt` cannot boot this exact kernel by any device
# short of shipping a non-stock one, which is the one option this project
# should avoid (see #1235's own reasoning).
#
# So this now uses `-M raspi3b` instead — a QEMU machine type that models
# real Raspberry Pi 3B hardware rather than swapping in virtio, and boots
# the *actual* built image with no kernel or initramfs changes:
#
#   - Storage: the *whole* raw image (not just the root partition, unlike
#     verify-image.sh) is handed to the guest as an SD card (`-sd`), so the
#     guest sees the same partition table and the same PARTUUIDs already
#     baked into /etc/fstab and cmdline.txt. `CONFIG_MMC_SDHCI_IPROC` and
#     `CONFIG_MMC_BCM2835_MMC` are both built into this kernel — the same
#     driver a real Pi's SD slot uses — matching QEMU's own documented
#     raspi3b/raspi4b peripheral list ("SD/MMC host controller").
#   - Network: a USB Ethernet adapter (`-device usb-net`, CDC-ECM) on the
#     guest's emulated DWC2 USB host controller — QEMU's raspi3b *and*
#     raspi4b both implement DWC2, but raspi4b's own peripheral list
#     explicitly calls out "PCIE Root Port" and "GENET Ethernet Controller"
#     as *not* implemented, which is the only network path real Pi4
#     hardware actually has. raspi3b's Ethernet is a USB device behind an
#     internal hub on real hardware too (the LAN7515 chip), so this is not
#     a QEMU shortcut — it is the same path a real Pi 3B takes, and DWC2 is
#     genuinely present on both machine types. `CONFIG_USB_DWC2=y` and
#     `CONFIG_USB_NET_CDCETHER=m` are both present in this kernel — a
#     module is fine here, unlike for the root device itself, since it
#     loads from the already-mounted rootfs rather than needing to exist
#     before mounting can happen at all. See RPi-Distro/pi-gen#827, whose
#     contributors independently landed on this same combination for the
#     same reason.
#   - Boot path: a real Pi's firmware reads config.txt/cmdline.txt itself;
#     QEMU has no such firmware. `-kernel`/`-dtb`/`-append` load the arm64
#     kernel and a matching Broadcom device tree straight out of the boot
#     partition (kernel8.img and bcm2710-rpi-3-b(-plus).dtb, extracted
#     below), and supply the kernel command line directly. Unlike the old
#     `virt` invocation, the `root=`/`rootfstype=`/`fsck.repair=` tokens are
#     read out of the image's own cmdline.txt rather than asserted here —
#     pi-gen already stamps a `root=PARTUUID=…` there that names this exact
#     disk, so reusing it is both less to keep in sync and immune to
#     whichever `/dev/mmcblk*` number a given QEMU machine type happens to
#     enumerate the SD card as (raspi3b and raspi4b do not agree — see
#     RPi-Distro/pi-gen#827 — PARTUUID does not care). `console=` is
#     overridden to `ttyAMA0,115200` (cmdline.txt's own `console=serial0` is
#     a firmware-only alias QEMU never resolves) and `dwc_otg.lpm_enable=0`
#     is added — a known-necessary workaround for QEMU's DWC2 model, per
#     every working raspi3b example found while fixing this.
#   - Console: PL011 (`ttyAMA0`) again — raspi3b wires the same ARM-standard
#     UART real Pi hardware's `ttyAMA0` is, and `SERIAL_AMBA_PL011` is built
#     directly into kernel8.img with no initramfs and no device-tree
#     overlay needed.
#
# What layer C does not, and cannot, prove is unchanged by this switch:
# raspi3b is still not real Pi 4 hardware — the machine this image is
# actually meant to run on — and QEMU's own documentation lists its
# peripheral model as incomplete (no PWM, and raspi4b specifically lacks
# PCIe/GENET). See CLAUDE.md's ops.md for the full caveat.
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

if ! command -v qemu-img >/dev/null 2>&1; then
	echo "qemu-img is required (Debian/Ubuntu: apt-get install qemu-utils, pulled in already by qemu-system-arm)" >&2
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

# Always a private copy in $WORK, never the caller's own file — the padding
# below (and anything future) needs to mutate this image, and a plain .img
# argument (not just the ordinary .xz case) must not come back a different
# size than it went in.
RAW_IMAGE="$WORK/image.img"
case "$IMAGE_PATH" in
*.xz)
	echo "qemu-boot-smoke-test.sh: decompressing..."
	unxz -k -c "$IMAGE_PATH" >"$RAW_IMAGE"
	;;
*)
	cp "$IMAGE_PATH" "$RAW_IMAGE"
	;;
esac

# QEMU's `-sd` models real SD card protocol closely enough to enforce a
# real SD card's own constraint: capacity has to be a power of two bytes.
# pi-gen's own image is sized to fit its partitions plus a little slack
# (3.02 GiB, last seen), which QEMU rejects outright ("Invalid SD card
# size ... has to be a power of 2") rather than rounding — found on the
# first real run of this machine type (dknowles2/trusty-track#1235).
# Padding the raw file up to the next power of two only grows unpartitioned
# space at the end of the disk; the partition table and every filesystem in
# it are untouched, so this loses nothing (the same reasoning `qemu-img
# resize`'s own docs give for growing, as opposed to shrinking, an image).
IMAGE_BYTES=$(stat -c%s "$RAW_IMAGE")
SD_BYTES=1
while [[ "$SD_BYTES" -lt "$IMAGE_BYTES" ]]; do
	SD_BYTES=$((SD_BYTES * 2))
done
if [[ "$SD_BYTES" -ne "$IMAGE_BYTES" ]]; then
	echo "qemu-boot-smoke-test.sh: padding the image from $IMAGE_BYTES to $SD_BYTES bytes (QEMU's -sd requires a power-of-two size)..."
	qemu-img resize -f raw "$RAW_IMAGE" "$SD_BYTES" >/dev/null
fi

echo "qemu-boot-smoke-test.sh: extracting the kernel, device tree and cmdline.txt from the boot partition..."
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

# raspi3b models the real Broadcom BCM2837, so it needs that board's own
# device tree — the same file real Pi 3B firmware would pick — rather than
# QEMU synthesising one the way `virt` did. Raspberry Pi OS ships DTBs for
# every board it supports side by side in the boot partition; try the 3B+
# name first (what current examples in RPi-Distro/pi-gen#827 use), falling
# back to the plain 3B name, and fail with the actual directory listing
# rather than a confusing QEMU error if neither is there.
DTB="$WORK/board.dtb"
if [[ -f "$BOOT_MOUNT/bcm2710-rpi-3-b-plus.dtb" ]]; then
	cp "$BOOT_MOUNT/bcm2710-rpi-3-b-plus.dtb" "$DTB"
elif [[ -f "$BOOT_MOUNT/bcm2710-rpi-3-b.dtb" ]]; then
	cp "$BOOT_MOUNT/bcm2710-rpi-3-b.dtb" "$DTB"
else
	echo "FAIL: no bcm2710-rpi-3-b(-plus).dtb in the boot partition" >&2
	ls -la "$BOOT_MOUNT" >&2 || true
	umount "$BOOT_MOUNT"
	losetup -d "$LOOP_DEV"
	LOOP_DEV=""
	exit 1
fi

# Reuse the image's own root=/rootfstype=/fsck.repair= tokens rather than
# asserting a device name — see the header comment for why PARTUUID beats
# guessing which /dev/mmcblk* number this machine type enumerates the SD
# card as. cmdline.txt is one line; grab each token by name so token order
# in it doesn't matter.
IMAGE_CMDLINE=$(cat "$BOOT_MOUNT/cmdline.txt")
umount "$BOOT_MOUNT"
losetup -d "$LOOP_DEV"
LOOP_DEV=""

ROOT_TOKEN=$(printf '%s\n' "$IMAGE_CMDLINE" | grep -oE 'root=[^ ]+' || true)
ROOTFSTYPE_TOKEN=$(printf '%s\n' "$IMAGE_CMDLINE" | grep -oE 'rootfstype=[^ ]+' || true)
FSCK_TOKEN=$(printf '%s\n' "$IMAGE_CMDLINE" | grep -oE 'fsck\.repair=[^ ]+' || true)
if [[ -z "$ROOT_TOKEN" ]]; then
	echo "FAIL: cmdline.txt has no root= token: $IMAGE_CMDLINE" >&2
	exit 1
fi

# console=serial0 in cmdline.txt is a firmware-only alias a real Pi's own
# bootloader resolves; QEMU never reads cmdline.txt at all (see the header
# comment), so it is overridden here to the PL011 name raspi3b actually
# wires up. dwc_otg.lpm_enable=0 works around a known QEMU DWC2 emulation
# issue — every working raspi3b boot example found while fixing #1235
# carries it.
CMDLINE="console=ttyAMA0,115200 ${ROOT_TOKEN} ${ROOTFSTYPE_TOKEN:-rootfstype=ext4} rw rootwait ${FSCK_TOKEN:-fsck.repair=yes} dwc_otg.lpm_enable=0"

echo "qemu-boot-smoke-test.sh: booting under QEMU (this can take several minutes under emulation)..."
qemu-system-aarch64 \
	-M raspi3b \
	-smp 4 \
	-m "$QEMU_MEMORY_MB" \
	-kernel "$KERNEL" \
	-dtb "$DTB" \
	-append "$CMDLINE" \
	-sd "$RAW_IMAGE" \
	-device usb-net,netdev=net0 \
	-netdev "user,id=net0,hostfwd=tcp::${HOST_HEALTH_PORT}-:8000" \
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
