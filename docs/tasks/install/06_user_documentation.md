# Install Channel 6: User-Facing Installation Documentation [COMPLETED]

> **Built.** `docs/user/install.md` and the four per-channel pages, wired
> into the mkdocs nav.

## Audience

**Writers / doc maintainers.** This task defines what installation
documentation needs to be written, for whom, and where it lives. The
engineering tasks (`01`–`05`) focus on building and packaging; this task
focuses on helping end users successfully install and run Trusty Track.

---

## Documentation Set

| Document | File | Audience |
|----------|------|----------|
| Installation overview / "which method?" | `docs/user/install.md` | All users |
| From source (developer) | `docs/user/install-from-source.md` | Developers |
| Docker / Docker Compose | `docs/user/install-docker.md` | Self-hosters |
| Raspberry Pi | `docs/user/install-raspberry-pi.md` | Pi / appliance users |
| macOS app | `docs/user/install-mac.md` | Mac users |
| Windows app | `docs/user/install-windows.md` | Windows users |

All documents live under `docs/user/` and are linked from the top-level
`README.md` and from `docs/user/install.md`.

---

## Guiding Principles

Apply the same principles as the existing user documentation plan
(`tasks/docs/00_overview.md`):

- **Non-technical language.** No jargon: no "FastAPI", no "GraphQL",
  no "venv", no "npm". If a terminal command must be shown, precede it
  with plain-English explanation of what it does and what the user will see.
- **Screenshots for every meaningful step.** No UI action should be
  described without a screenshot.
- **Numbered steps** for sequential actions.
- **Write for the actual audience.** The Docker guide can assume the reader
  knows what a terminal is. The Mac/Windows guides cannot.
- **Troubleshooting sections** — cover the two or three most likely failure
  modes for each method.

---

## Document Specs

### `docs/user/install.md` — Which Install Method Should I Use?

A short decision guide that helps users pick the right method without
reading all the docs.

Sections:
1. **Comparison table** — one row per method, columns: Difficulty, Platforms,
   Best for, Link.
2. **Quick recommendations:**
   - "I want to try it out on my Mac or Windows PC" → Mac / Windows installer.
   - "I want to run it permanently on my home network" → Docker or Raspberry Pi.
   - "I'm a developer" → From source.
   - "I want a dedicated plug-in appliance" → Raspberry Pi.
3. **System requirements** per method (OS versions, RAM, disk space).

---

### `docs/user/install-from-source.md` — Developer Install

Audience: developers comfortable with terminals.

Sections:
1. Prerequisites (Python ≥ 3.10, Node.js ≥ 18, Git).
2. Clone the repository.
3. Run the install script (`scripts/install.sh`) — or manual steps.
4. Start the server (`scripts/serve.sh`).
5. Open `http://localhost:8000` in a browser.
6. How to update (git pull + rebuild frontend + restart).

---

### `docs/user/install-docker.md` — Docker Compose Install

Audience: self-hosters who have Docker installed.

Sections:
1. Prerequisites (Docker Desktop on Mac/Windows, or Docker Engine on Linux).
2. Copy-paste the `docker-compose.yml` (include the full file in a code block).
3. Run `docker compose up -d`.
4. Open `http://localhost:8000`.
5. How to stop (`docker compose down`).
6. How to update (pull new image, `docker compose up -d`).
7. Where data lives (the named volume; how to back it up).
8. Troubleshooting:
   - Port 8000 already in use.
   - Container exits immediately (health check / startup failure).
   - Can't reach the app from another device on the network.

---

### `docs/user/install-raspberry-pi.md` — Raspberry Pi Install

Audience: users who have a Pi and are comfortable SSHing into it.

Sections:
1. What you'll need (Pi model, SD card size, power supply, network cable
   or Wi-Fi). Recommend Pi 4 (2 GB+) or Pi 5.
2. Flash Raspberry Pi OS Lite (64-bit) using Raspberry Pi Imager.
   - Screenshot of Raspberry Pi Imager with the correct image selected.
   - How to enable SSH and set username/password in the imager settings.
3. Boot the Pi and SSH in.
4. Run the install script (one command).
5. Wait for the install to complete (~10–15 minutes on first run due to
   npm install).
6. Access the app:
   - From the Pi itself: `https://localhost:8000`
   - From another device: `https://trustytrack.local:8000`
   - Accepting the self-signed certificate warning (screenshot for
     Chrome, Firefox, Safari).
7. Optional: set up Wi-Fi hotspot mode.
8. How to update (re-run the install script or `git pull` + rebuild).
9. Troubleshooting:
   - Can't SSH in.
   - Service not starting (`systemctl status trustytrack`).
   - Can't reach from other devices (firewall, mDNS not resolving).
   - Camera not working (self-signed cert instructions).

---

### `docs/user/install-mac.md` — macOS App Install

Audience: non-technical Mac users.

Sections:
1. Download the `.dmg` from the GitHub Releases page (include a
   screenshot of the Releases page with the correct file highlighted).
2. Open the `.dmg` and drag Trusty Track to Applications.
   - Screenshot of the DMG window.
3. Double-click Trusty Track in Applications.
4. If Gatekeeper warns "cannot be opened because it is from an unidentified
   developer":
   - Screenshot of the Gatekeeper dialog.
   - Step-by-step: Right-click → Open → Open.
5. Your browser will open to Trusty Track automatically.
6. When you're done, quit Trusty Track from the menu bar icon (or
   Force Quit from Activity Monitor).
7. Where your data is stored (`~/Library/Application Support/TrustyTrack/`).
8. How to update (download the new `.dmg`, replace the app in Applications).
9. Troubleshooting:
   - App doesn't open / bounces in Dock.
   - Browser doesn't open automatically.
   - App crashes on startup.

---

### `docs/user/install-windows.md` — Windows App Install

Audience: non-technical Windows users.

Sections:
1. Download the installer `.exe` from the GitHub Releases page.
2. Run the installer.
3. If Windows Defender SmartScreen warns "Windows protected your PC":
   - Screenshot of the SmartScreen dialog.
   - Step-by-step: "More info" → "Run anyway".
4. Follow the installer wizard (screenshots for each step).
5. Launch Trusty Track from the Start Menu or Desktop shortcut.
6. Your browser will open to Trusty Track automatically.
7. To quit, right-click the Trusty Track icon in the system tray → Quit.
8. To uninstall: Settings → Apps → TrustyTrack → Uninstall.
9. Where your data is stored (`%APPDATA%\TrustyTrack\`).
10. How to update (download the new installer and run it; it will replace
    the previous version).
11. Troubleshooting:
    - "Windows cannot find the file" after install.
    - App starts but browser doesn't open.
    - Antivirus flags the installer.

---

## Screenshot Standards

Follow the standards from `tasks/docs/00_overview.md`:

- Captured at 1280×800 or wider.
- Use realistic sample data.
- Saved as PNG in `docs/assets/screenshots/install/<guide-slug>/`.
- Named `<step-number>-<short-description>.png`.

For OS-specific dialogs (Gatekeeper, SmartScreen), capture on an actual
Mac and Windows machine. Do not simulate or mock these dialogs.

---

## README.md Updates

The top-level `README.md` should be updated to include:

1. A brief "Getting Started" section with a table of install methods and links.
2. Remove or move developer setup steps to `docs/user/install-from-source.md`
   (keep a short "For developers" link in the README).

---

## Definition of Done

- [ ] `docs/user/install.md` written and linked from `README.md`.
- [ ] `docs/user/install-from-source.md` written.
- [ ] `docs/user/install-docker.md` written with copy-paste `docker-compose.yml`.
- [ ] `docs/user/install-raspberry-pi.md` written with screenshots.
- [ ] `docs/user/install-mac.md` written with screenshots.
- [ ] `docs/user/install-windows.md` written with screenshots.
- [ ] All install docs linked from `README.md` and from `docs/user/install.md`.
- [ ] All screenshot paths in docs match actual files in `docs/assets/screenshots/`.
