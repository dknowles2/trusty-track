#!/bin/bash -e
# Test layer A: the image asserts itself as it is built, inside the same
# chroot the app was just installed into. A pi-gen build that "succeeds"
# while missing the app, or while still carrying the build toolchain it
# promised to strip, is exactly the failure mode CLAUDE.md's timer-profile
# provenance rule is about generalising here: a claim this project makes
# ("ships prebuilt", "no dev toolchain at runtime") is checked, not assumed.
#
# Layer B (deploy/raspberry-pi/verify-image.sh) checks the same promises
# again from outside the finished .img, without booting it — this layer
# fails fast, inside the build, before a slow QEMU boot test (stage 2) would
# ever get the chance to.
on_chroot << 'EOF'
set -euo pipefail

echo "stage-trustytrack: verifying the venv can import the app..."
TRUSTYTRACK_DATA_DIR="$(mktemp -d)"
export TRUSTYTRACK_DATA_DIR
/opt/trustytrack/backend/venv/bin/python3 -c "import backend.api.main"
rm -rf "$TRUSTYTRACK_DATA_DIR"

echo "stage-trustytrack: verifying the frontend was built..."
test -f /opt/trustytrack/frontend/dist/index.html

echo "stage-trustytrack: verifying the systemd units are well-formed..."
systemd-analyze verify \
	/etc/systemd/system/trustytrack.service \
	/etc/systemd/system/trustytrack-firstboot.service

echo "stage-trustytrack: verifying the build toolchain did not survive..."
for tool in node npm git; do
	if command -v "$tool" >/dev/null 2>&1; then
		echo "stage-trustytrack: FAIL — '$tool' is still on PATH in the runtime image" >&2
		exit 1
	fi
done

echo "stage-trustytrack: layer A checks passed."
EOF
