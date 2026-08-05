# Trusty Track — Windows build script
#
# Usage:
#   .\packaging\build-windows.ps1             # produces dist\TrustyTrack-<version>-setup.exe
#   .\packaging\build-windows.ps1 -ExeOnly    # produces packaging\dist\TrustyTrack\ only
#
# Prerequisites:
#   - Python 3.10+
#   - Node.js 18+
#   - Inno Setup 6  (https://jrsoftware.org/isinfo.php)  -- not needed with -ExeOnly
#
# Optional (code signing):
#   - Set $env:SIGN_CERT_PATH and $env:SIGN_CERT_PASSWORD

param(
    [switch]$ExeOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$Venv      = Join-Path $ScriptDir ".build-venv"

Set-Location $Root

# ── Prerequisites ──────────────────────────────────────────────────────────────

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "python not found."
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node not found."
    exit 1
}

# ── 1. Isolated build venv ────────────────────────────────────────────────────
# Guarantees all deps from pyproject.toml are present for PyInstaller analysis.

Write-Host "Setting up build venv..."
python -m venv $Venv
& "$Venv\Scripts\pip.exe" install --quiet --upgrade pip
& "$Venv\Scripts\pip.exe" install --quiet "$Root"
& "$Venv\Scripts\pip.exe" install --quiet pyinstaller pyinstaller-hooks-contrib pystray

# Not a here-string: PowerShell requires `"@` to end the line it closes on, and
# `"@ 2>$null` here made the whole script unparseable.
$VersionExpr = 'from backend.version import __version__; print(__version__)'
$Version = & "$Venv\Scripts\python.exe" -c $VersionExpr 2>$null
if (-not $Version) { $Version = "0.0.0" }
Write-Host "Building Trusty Track v$Version for Windows..."

# ── 2. Frontend ───────────────────────────────────────────────────────────────

Write-Host "Building frontend..."
Set-Location "$Root\frontend"
npm ci --silent
npm run build --silent
Set-Location $Root

# ── 3. App icon (.ico) ────────────────────────────────────────────────────────

$LogoPng = "$Root\frontend\src\assets\logo_transparent.png"
$IcoPath = "$ScriptDir\TrustyTrack.ico"

if (Test-Path $LogoPng) {
    Write-Host "Generating app icon..."
    & "$Venv\Scripts\python.exe" "$ScriptDir\make_ico.py" $LogoPng $IcoPath
    $env:APP_ICON = $IcoPath
    Write-Host "Icon: $IcoPath"
} else {
    Write-Warning "Logo not found at $LogoPng — building without app icon"
    $env:APP_ICON = ""
}

# ── 4. PyInstaller ────────────────────────────────────────────────────────────

Write-Host "Building PyInstaller bundle..."
Set-Location "$Root\packaging"
& "$Venv\Scripts\pyinstaller.exe" trustytrack.spec --distpath dist --workpath build --noconfirm
Set-Location $Root

$ExeDir = "$Root\packaging\dist\TrustyTrack"
if (-not (Test-Path $ExeDir)) {
    Write-Error "PyInstaller did not produce $ExeDir"
    exit 1
}

# ── 5. Optional code signing ──────────────────────────────────────────────────

if ($env:SIGN_CERT_PATH -and (Test-Path $env:SIGN_CERT_PATH)) {
    Write-Host "Code signing..."
    $signtool = "signtool"
    & $signtool sign /f $env:SIGN_CERT_PATH /p $env:SIGN_CERT_PASSWORD `
        /tr http://timestamp.digicert.com /td sha256 /fd sha256 `
        "$ExeDir\trustytrack-server.exe"
}

if ($ExeOnly) {
    Write-Host ""
    Write-Host "Executable directory: $ExeDir"
    exit 0
}

# ── 6. Inno Setup installer ───────────────────────────────────────────────────

$IsccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "iscc"
)
$Iscc = $null
foreach ($p in $IsccPaths) {
    if (Get-Command $p -ErrorAction SilentlyContinue) {
        $Iscc = $p
        break
    }
}
if (-not $Iscc) {
    Write-Error "Inno Setup (iscc) not found. Download from https://jrsoftware.org/isinfo.php"
    exit 1
}

Write-Host "Creating installer with Inno Setup..."
$env:APP_VERSION = $Version
$env:ROOT_DIR    = $Root
& $Iscc "$Root\packaging\TrustyTrack.iss" /DMyAppVersion=$Version

# ── 7. Move output ────────────────────────────────────────────────────────────

New-Item -ItemType Directory -Force -Path "$Root\dist" | Out-Null
$InstallerSrc = "$Root\packaging\installer-output\TrustyTrack-setup.exe"
$InstallerDst = "$Root\dist\TrustyTrack-$Version-setup.exe"
if (Test-Path $InstallerSrc) {
    Move-Item -Force $InstallerSrc $InstallerDst
    Write-Host ""
    Write-Host "Build complete: $InstallerDst"
} else {
    Write-Error "Installer was not produced. Check Inno Setup output."
}
