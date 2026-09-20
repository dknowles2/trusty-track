#!/usr/bin/env bash
# Trusty Track -- put the Developer ID certificate where codesign can find it
#
# Runs on a CI macOS runner before packaging/build-mac.sh. A fresh runner has
# an empty keychain, so setting APPLE_SIGN_IDENTITY alone makes `codesign`
# fail with "no identity found": the identity has to be *imported* first, and
# this is the one place that happens for both the packaging check and the
# release, so the two cannot drift.
#
# Reads from the environment (repository secrets, in CI):
#   APPLE_CERTIFICATE_P12_BASE64  the Developer ID Application certificate and
#                                 its private key, exported from Keychain
#                                 Access as a .p12 and base64-encoded
#   APPLE_CERTIFICATE_PASSWORD    the password that .p12 was exported with
#   APPLE_SIGN_IDENTITY           optional; when set, the import is checked to
#                                 have produced exactly this identity, so a
#                                 mismatch fails here with the list of what
#                                 was found rather than three steps later
#
# With no certificate in the environment this does nothing and exits 0, so a
# pull request from a fork (no secrets) still builds -- build-mac.sh signs
# ad-hoc in that case, which is what it did before there was an identity.
#
# The certificate chains to Apple's "Developer ID Certification Authority
# (G2)" intermediate, which not every Mac has -- codesign then reports the
# identity as invalid and refuses to use it, which is what the first
# by-hand import ran into. DeveloperIDG2CA.cer beside this script is that
# intermediate, checked in (it is public, and valid to 2031) so a release
# does not depend on apple.com being reachable.

set -euo pipefail

if [[ -z "${APPLE_CERTIFICATE_P12_BASE64:-}" ]]; then
    echo "No APPLE_CERTIFICATE_P12_BASE64 in the environment; nothing to import."
    echo "build-mac.sh will sign the bundle ad-hoc."
    exit 0
fi
if [[ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
    echo "ERROR: APPLE_CERTIFICATE_P12_BASE64 is set but APPLE_CERTIFICATE_PASSWORD is not." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERMEDIATE="$SCRIPT_DIR/DeveloperIDG2CA.cer"
WORK="${RUNNER_TEMP:-$(mktemp -d)}"
KEYCHAIN="$WORK/trustytrack-signing.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"
P12="$WORK/trustytrack-signing.p12"

# The decoded .p12 is the private key on disk; it is gone the moment this
# script exits, whichever way it exits.
trap 'rm -f "$P12"' EXIT
printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode > "$P12"

echo "Creating a keychain for the signing identity..."
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
# Six hours before it locks itself again; a build is minutes.
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"

security import "$INTERMEDIATE" -k "$KEYCHAIN" >/dev/null
security import "$P12" -P "$APPLE_CERTIFICATE_PASSWORD" \
    -A -t cert -f pkcs12 -k "$KEYCHAIN" >/dev/null

# Without this, the first `codesign` call blocks on a GUI prompt asking
# whether the tool may use the key -- a prompt nothing on a runner can
# answer, so the job hangs until its timeout. The output is a dump of the
# key's attributes, which nobody needs in a build log.
security set-key-partition-list -S apple-tool:,apple: -s \
    -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# Put the new keychain on the search list *ahead of* whatever is already
# there rather than replacing the list, so a developer running this on their
# own machine keeps their login keychain.
EXISTING=()
while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
    line="${line%\"}"; line="${line#\"}"        # strip the quotes
    [[ -n "$line" ]] && EXISTING+=("$line")
done < <(security list-keychains -d user)
# ${arr[@]+"${arr[@]}"} rather than "${arr[@]}": under `set -u`, bash 3.2
# treats an empty array's expansion as an unbound variable.
security list-keychains -d user -s "$KEYCHAIN" ${EXISTING[@]+"${EXISTING[@]}"}

echo "Identities now available for code signing:"
security find-identity -v -p codesigning "$KEYCHAIN"

if [[ -n "${APPLE_SIGN_IDENTITY:-}" ]]; then
    if ! security find-identity -v -p codesigning "$KEYCHAIN" \
        | grep -F -q "\"$APPLE_SIGN_IDENTITY\""; then
        echo "ERROR: the import did not produce a valid identity named" >&2
        echo "  $APPLE_SIGN_IDENTITY" >&2
        echo "Check APPLE_SIGN_IDENTITY against the list above -- it must be the" >&2
        echo "certificate's full name, e.g." >&2
        echo '  Developer ID Application: Jane Doe (ABCDE12345)' >&2
        exit 1
    fi
fi
