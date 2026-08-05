# Install Channel 4: Desktop App (macOS + Windows) [COMPLETED]

> **Built.** `packaging/` — `trustytrack.spec`, `build-mac.sh`,
> `build-windows.ps1`, `TrustyTrack.iss` — and the two `docs/user/install-*`
> pages.
>
> **There is no separate launcher (§4.3).** `run_server.py` is the whole
> application: it starts uvicorn, waits for health, opens the browser, and puts
> a menu-bar item on macOS or a tray icon on Windows. The `launcher.py` this
> plan describes was written, superseded, and then kept — the Windows installer
> was still shipping it as a *Python source file* onto machines with no
> interpreter, next to the frozen executable that already did all of it. It has
> been deleted.
>
> That same drift left the Windows installer pointing every shortcut at
> `TrustyTrack.exe`, which no build produces; the executable is
> `trustytrack-server.exe`. `backend/tests/test_packaging.py` now holds the
> names together.
>
> **The app serves HTTPS**, with a certificate generated on first run, because
> the camera and the barcode scanner need a secure context. Both install pages
> said `http://`.

## Audience

Non-technical users — typically a pack admin or a volunteer — who are
comfortable downloading and running installers but have no interest in
terminals, Python, or Docker. Typical scenario:

> Someone downloads `TrustyTrack-1.0-mac.dmg`, drags it to Applications,
> double-clicks the icon, and their browser opens to the app. No terminal.
> No manual steps.

---

## Approach: Bundled Python Server + Browser Launch

The application architecture (Python backend + React frontend) rules out a
pure-frontend desktop app. The chosen approach is:

1. **PyInstaller** bundles the FastAPI backend (+ all Python dependencies)
   and the compiled React frontend (`dist/`) into a single platform-native
   executable.
2. A **thin launcher** starts that executable, waits for the server to be
   ready (polls `/health`), then opens the user's default browser to
   `http://localhost:8000`.
3. Platform-specific packaging wraps this into:
   - macOS: a `.app` bundle inside a `.dmg` disk image.
   - Windows: a `.exe` installer via Inno Setup.

### Why not Electron?

Electron would ship a full Chromium browser (~150 MB), making the bundle
unnecessarily large. Since we already have a web frontend, using the user's
existing browser is lighter and simpler.

### TLS / Camera Access

The browser camera API (`getUserMedia`) requires a secure context (HTTPS or
`localhost`). The app will run on `localhost`, which is a secure context in
modern browsers — no TLS certificate is needed for the desktop app.

---

## Prerequisite

Unified server mode (task `01_from_source.md §1.1`) must be implemented so
FastAPI serves the built frontend, and the configurable data directory
(§1.2) must be set up so data lives in a user-writable location outside
the app bundle.

---

## Engineering Tasks

### 4.1 — Data Directory (macOS + Windows Conventions)

The desktop app should use platform-appropriate data directories:

| Platform | Default data directory |
|----------|----------------------|
| macOS | `~/Library/Application Support/TrustyTrack/` |
| Windows | `%APPDATA%\TrustyTrack\` |
| Linux | `~/.trustytrack/` (fallback) |

The launcher sets `TRUSTYTRACK_DATA_DIR` before starting the server, so
the backend code doesn't need to know which platform it's on.

---

### 4.2 — PyInstaller Spec File (`packaging/trustytrack.spec`)

A PyInstaller spec file that bundles:

- All Python source files from `backend/`.
- All Python dependencies from `pyproject.toml`.
- The compiled frontend at `frontend/dist/` (added as a data file so
  FastAPI's `StaticFiles` can find it at runtime).
- `uvicorn` and all its extras.

Key PyInstaller options:
- `--onefile` or `--onedir` — `--onedir` is preferred on Windows (faster
  startup) and macOS (smaller `.app`).
- `--hidden-import` for any packages that PyInstaller misses (common with
  FastAPI/Uvicorn).
- `--add-data "frontend/dist:frontend/dist"` to bundle the built frontend.

**Runtime path fix:** FastAPI's `StaticFiles` mount uses a relative path.
After PyInstaller bundles the app, the working directory changes. The
backend must detect the PyInstaller bundle path:

```python
import sys, os

if getattr(sys, 'frozen', False):
    # Running inside a PyInstaller bundle
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent.parent

FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
```

---

### 4.3 — Launcher Script (`packaging/launcher.py`)

A small Python script that:

1. Determines the path to the bundled `uvicorn` executable (or calls it
   as a module).
2. Starts the server as a subprocess.
3. Polls `http://localhost:8000/health` every 500 ms until it returns 200
   (or times out after 30 s with an error dialog).
4. Opens `http://localhost:8000` in the user's default browser.
5. Waits for the subprocess to exit (i.e. stays alive to keep the server
   running).
6. On SIGTERM / window close, sends SIGTERM to the server subprocess.

On macOS, the launcher can be a simple Python script invoked by the `.app`
bundle's `CFBundleExecutable`. On Windows, it should be a `pythonw.exe`
invocation (no console window) or compiled into a Windows GUI `.exe`.

---

### 4.4 — macOS Packaging

**Tools:** `create-dmg` (Homebrew) or `hdiutil`.

**Steps:**

1. Build frontend: `npm run build` in `frontend/`.
2. Run PyInstaller: produces `dist/TrustyTrack/` (or `dist/TrustyTrack.app`).
3. Wrap in a `.app` bundle if not already done by PyInstaller.
4. Optionally code-sign with an Apple Developer certificate:
   ```bash
   codesign --deep --force --verify --verbose \
     --sign "Developer ID Application: ..." \
     dist/TrustyTrack.app
   ```
5. Notarize with `notarytool` (required for Gatekeeper on macOS 12+).
6. Create a `.dmg` with a custom background and Applications symlink:
   ```bash
   create-dmg \
     --volname "TrustyTrack" \
     --app-drop-link 600 185 \
     "TrustyTrack-<version>-mac.dmg" \
     "dist/TrustyTrack.app"
   ```

**Code signing note:** Without an Apple Developer certificate, users will
see a Gatekeeper warning. Document the workaround (`Right-click → Open`).
For an open-source project, ad-hoc signing is acceptable for initial releases.

---

### 4.5 — Windows Packaging

**Tools:** Inno Setup (free, widely used).

**Steps:**

1. Build frontend and run PyInstaller (on a Windows runner, or via
   cross-compilation using Wine — Wine is unreliable; prefer a Windows CI
   runner).
2. Write an Inno Setup script (`packaging/TrustyTrack.iss`) that:
   - Installs the `dist/TrustyTrack/` directory to
     `%PROGRAMFILES%\TrustyTrack\`.
   - Creates a Start Menu shortcut and optional Desktop shortcut.
   - Creates an uninstaller.
   - Optionally sets up a registry entry for Windows startup (opt-in).
3. Compile with `iscc TrustyTrack.iss` → `TrustyTrack-<version>-setup.exe`.

**Windows Defender note:** Without a code-signing certificate, Windows
Defender SmartScreen may warn users. Document the workaround ("More info →
Run anyway"). A future task can add Authenticode signing.

---

### 4.6 — Build Scripts

`packaging/build-mac.sh` and `packaging/build-windows.ps1` (or a shared
`packaging/build.py`) that:

1. Check prerequisites (PyInstaller, create-dmg / Inno Setup).
2. Build the frontend.
3. Run PyInstaller.
4. Run the platform packager.
5. Output the final installer file to `dist/`.

These scripts are the entry points for the CI release pipeline (§05).

---

## User Documentation Required

- `docs/user/install-mac.md` — macOS install guide.
  - Download link (GitHub Releases).
  - Open the `.dmg`, drag to Applications.
  - First-run Gatekeeper workaround (if unsigned).
  - How to quit the app (and that it will keep running in the background
    until quit).
  - Where data is stored (`~/Library/Application Support/TrustyTrack/`).
  - How to update.

- `docs/user/install-windows.md` — Windows install guide.
  - Download link.
  - Run the installer, follow the wizard.
  - SmartScreen workaround (if unsigned).
  - Where data is stored (`%APPDATA%\TrustyTrack\`).
  - How to update / uninstall.

See `06_user_documentation.md` for details.

---

## Definition of Done

- [ ] `packaging/trustytrack.spec` builds a working bundle on macOS (arm64
  and x86_64) and on Windows.
- [ ] The bundled app starts and opens the browser without any terminal.
- [ ] Data is stored in the correct platform directory.
- [ ] The app shuts down cleanly when the window/process is closed.
- [ ] macOS `.dmg` is produced and installable.
- [ ] Windows `.exe` installer is produced and installable.
- [ ] Both installers are tested on a clean OS (no Python/Node pre-installed).
