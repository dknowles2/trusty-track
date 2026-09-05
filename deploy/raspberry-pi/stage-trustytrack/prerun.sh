#!/bin/bash -e
# Boilerplate every pi-gen stage after the first needs: carry the previous
# stage's rootfs forward as this stage's starting point. Copied verbatim from
# pi-gen's own stage2/prerun.sh — there is nothing project-specific about it.
if [ ! -d "${ROOTFS_DIR}" ]; then
	copy_previous
fi
