#!/usr/bin/env bash
# Trusty Track — macOS build script
#
# Usage:
#   ./packaging/build-mac.sh            # produces dist/TrustyTrack-<version>-mac.dmg
#   ./packaging/build-mac.sh --app-only # produces packaging/dist/TrustyTrack.app only
#
# Prerequisites:
#   - Python 3.10+
#   - Node.js 18+
#   - create-dmg (brew install create-dmg)  -- not needed with --app-only
#
# Optional (code signing):
#   - Set APPLE_SIGN_IDENTITY to your Developer ID Application name
#   - Set APPLE_TEAM_ID and APPLE_NOTARIZATION_PASSWORD for notarization

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
VENV="$SCRIPT_DIR/.build-venv"
cd "$ROOT"

APP_ONLY=false
for arg in "$@"; do
    [[ "$arg" == "--app-only" ]] && APP_ONLY=true
done

# Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found."; exit 1; }
command -v node    >/dev/null 2>&1 || { echo "ERROR: node not found."; exit 1; }

# 1. Set up an isolated build venv with all deps + PyInstaller
#    This guarantees every package in pyproject.toml is present when
#    PyInstaller analyses and bundles the app.
#    uv when the machine has it, pip when it does not: uv resolves and installs
#    the same set in a few seconds where pip takes most of a minute, and it is
#    what the rest of this project already builds with. The pip path stays for
#    a contributor who has only Python.
echo "Setting up build venv..."
if command -v uv >/dev/null 2>&1; then
    # `--python python3` because uv otherwise picks the newest interpreter it
    # can find on the machine, which is not the one the pip path below would
    # have used and need not be one this project supports -- it chose 3.14
    # here. `--clear` because uv refuses an existing directory where
    # `python3 -m venv` reuses it, so a second build on a developer's machine
    # would fail where the first succeeded. CI never sees that: it is always a
    # fresh runner.
    uv venv --clear --python python3 "$VENV"
    uv pip install --python "$VENV/bin/python" \
        "$ROOT" pyinstaller pyinstaller-hooks-contrib rumps
else
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet "$ROOT"
    "$VENV/bin/pip" install --quiet pyinstaller pyinstaller-hooks-contrib rumps
fi

# Read version using the venv's Python so the path is consistent
VERSION=$("$VENV/bin/python" -c \
    "from backend.version import __version__; print(__version__)" \
    2>/dev/null || echo "0.0.0")
echo "Building Trusty Track v$VERSION for macOS..."

# 2. Build the frontend
echo "Building frontend..."
cd "$ROOT/frontend"
npm ci --silent
npm run build --silent
cd "$ROOT"

# 3. Generate .icns from the logo PNG so PyInstaller can embed it as the app icon.
#    Uses macOS-native sips + iconutil — no extra tools required.
LOGO_PNG="$ROOT/frontend/src/assets/logo_transparent.png"
ICONSET_DIR="$SCRIPT_DIR/TrustyTrack.iconset"
ICNS_PATH="$SCRIPT_DIR/TrustyTrack.icns"

if [[ -f "$LOGO_PNG" ]]; then
    echo "Generating app icon..."
    rm -rf "$ICONSET_DIR"
    mkdir -p "$ICONSET_DIR"
    for size in 16 32 64 128 256 512; do
        sips -z $size $size "$LOGO_PNG" --out "$ICONSET_DIR/icon_${size}x${size}.png"    >/dev/null 2>&1
        sips -z $((size*2)) $((size*2)) "$LOGO_PNG" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"
    rm -rf "$ICONSET_DIR"
    export APP_ICON="$ICNS_PATH"
    echo "Icon: $ICNS_PATH"
else
    echo "WARNING: Logo not found at $LOGO_PNG — building without app icon"
    export APP_ICON=""
fi

# 4. Build with PyInstaller (spec includes BUNDLE, so it creates TrustyTrack.app directly)
echo "Building PyInstaller bundle..."
cd "$ROOT/packaging"
"$VENV/bin/pyinstaller" trustytrack.spec --distpath dist --workpath build --noconfirm
cd "$ROOT"

APP_DIR="$ROOT/packaging/dist/TrustyTrack.app"

if [[ ! -d "$APP_DIR" ]]; then
    echo "ERROR: PyInstaller did not produce $APP_DIR"
    exit 1
fi

# 5. Stamp the version into the PyInstaller-generated Info.plist.
#
# PyInstaller's BUNDLE step already sets CFBundleExecutable = trustytrack-server
# (the real Mach-O binary from run_server.py).  Using a compiled binary rather
# than a shell script is what makes macOS register the app in the Dock.
echo "Stamping version $VERSION into Info.plist..."
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION"            "$APP_DIR/Contents/Info.plist"

# 6. Re-sign, which is not optional even with no Developer ID
#
# PyInstaller's BUNDLE step signs the app -- ad-hoc when there is no identity,
# which on arm64 is mandatory rather than decorative. Step 5 above then edits
# Info.plist, and an edited Info.plist breaks the signature that sealed it:
# `codesign -dv` reports `Info.plist=not bound` and verification fails with
# "plist or signature have been modified".
#
# That is worse than shipping no signature at all. A quarantined app with a
# *valid* ad-hoc signature gets the ordinary "unidentified developer" refusal,
# which the install guide walks a reader past with Open Anyway; a quarantined
# app with a *broken* one is reported as "damaged and can't be opened. You
# should move it to the Trash", and macOS offers no way past that at all. It
# reached users in v1.1.1, whose only remedy was `xattr` from a terminal.
#
# So the signing step runs either way: with the Developer ID when there is one,
# ad-hoc when there is not. Stamping the version before signing rather than
# re-signing after would work too, and is the wrong shape -- it would leave the
# next edit to the bundle free to break it again in the same silent way.
if [[ -n "${APPLE_SIGN_IDENTITY:-}" ]]; then
    echo "Code signing..."
    codesign --deep --force --verify --verbose \
        --sign "$APPLE_SIGN_IDENTITY" \
        --options runtime \
        "$APP_DIR"
else
    echo "No APPLE_SIGN_IDENTITY; re-signing ad-hoc so the bundle verifies..."
    codesign --deep --force --sign - "$APP_DIR"
fi

# Cheap, and the whole point of the block above. A bundle that does not verify
# here is one macOS will call damaged on somebody's machine.
codesign --verify --deep --strict "$APP_DIR"

if [[ "$APP_ONLY" == "true" ]]; then
    echo ""
    echo "App bundle: $APP_DIR"
    exit 0
fi

# 7. Create the .dmg
OUTPUT_DMG="$ROOT/dist/TrustyTrack-${VERSION}-mac.dmg"
mkdir -p "$ROOT/dist"

if command -v create-dmg >/dev/null 2>&1; then
    echo "Creating DMG with create-dmg..."
    ICON_ARG=()
    if [[ -f "$APP_DIR/Contents/Resources/icon.icns" ]]; then
        ICON_ARG=(--volicon "$APP_DIR/Contents/Resources/icon.icns")
    fi
    # `${ICON_ARG[@]+...}` rather than a plain `${ICON_ARG[@]}`: macOS ships
    # bash 3.2, where an empty array counts as unset, and `set -u` at the top
    # of this file turns expanding one into a fatal error. The app is built by
    # then, so the failure lands at the very last step with the whole build
    # already paid for.
    create-dmg \
        --volname "TrustyTrack" \
        ${ICON_ARG[@]+"${ICON_ARG[@]}"} \
        --window-pos 200 120 \
        --window-size 800 400 \
        --icon-size 100 \
        --icon "TrustyTrack.app" 200 185 \
        --hide-extension "TrustyTrack.app" \
        --app-drop-link 600 185 \
        "$OUTPUT_DMG" \
        "$APP_DIR" || {
        hdiutil create -volname "TrustyTrack" -srcfolder "$APP_DIR" -ov -format UDZO "$OUTPUT_DMG"
    }
else
    echo "create-dmg not found, using hdiutil..."
    hdiutil create -volname "TrustyTrack" -srcfolder "$APP_DIR" -ov -format UDZO "$OUTPUT_DMG"
fi

# 8. Optional notarization
if [[ -n "${APPLE_NOTARIZATION_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    echo "Notarizing..."
    xcrun notarytool submit "$OUTPUT_DMG" \
        --apple-id "${APPLE_ID:-}" \
        --password "$APPLE_NOTARIZATION_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait
    xcrun stapler staple "$OUTPUT_DMG"
fi

echo ""
echo "Build complete: $OUTPUT_DMG"
