#!/bin/bash -e
# "Ship prebuilt": Node and git are inputs to *building* Trusty Track, not to
# running it, so they come back out once 01-build is done with them. This is
# the step that makes that true rather than merely intended — 04-verify
# checks it landed.
#
# `gnupg` (pulled in by NodeSource's own setup script, not by us) is
# deliberately left alone: it is a general system utility, not part of the
# app's build toolchain the top-level issue is about, and apt's own
# repository-signature verification depends on `gpgv` rather than the full
# `gnupg` package, so removing it buys nothing and risks a subtler breakage
# this pi-gen build has no way to catch.
on_chroot << 'EOF'
set -euo pipefail

TO_PURGE=""
for pkg in nodejs npm git; do
	if dpkg -s "$pkg" >/dev/null 2>&1; then
		TO_PURGE="$TO_PURGE $pkg"
	fi
done
if [ -n "$TO_PURGE" ]; then
	# shellcheck disable=SC2086 # intentionally unquoted: a space-separated
	# package list built above, not a single value that could contain spaces.
	apt-get purge -y $TO_PURGE
fi
apt-get autoremove -y --purge

# The NodeSource repo definition and its signing key: nothing here will ever
# run `apt-get update` again with node installed, and a public image is
# downloaded by everybody, so there is no reason to leave a third-party apt
# source configured on it.
rm -f /usr/share/keyrings/nodesource.gpg
rm -f /etc/apt/sources.list.d/nodesource.sources
rm -f /etc/apt/sources.list.d/nodesource.list

apt-get clean
rm -rf /var/lib/apt/lists/*
EOF
