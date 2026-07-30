# Install Channel 5: Release Pipeline (CI/CD) [COMPLETED]

> **Built.** `.github/workflows/release.yml`, triggered on tags.

## Audience

**Maintainers** — this task is about automating the production of release
artifacts (Docker image, macOS `.dmg`, Windows `.exe` installer) using
GitHub Actions, so that publishing a new version is a single `git tag` +
`git push`.

---

## Prerequisite

All of the following must be complete before the pipeline is meaningful:

- Task `01_from_source.md` — unified server mode, configurable data dir.
- Task `02_docker.md` — `Dockerfile` and `docker-compose.yml`.
- Task `04_desktop_app.md` — `packaging/` scripts for macOS and Windows.

---

## Versioning

Semantic versioning (`MAJOR.MINOR.PATCH`). A release is triggered by pushing
a tag matching `v*.*.*` to `main`.

The version number should be embedded in:
- The Docker image tag.
- The macOS `.dmg` filename.
- The Windows installer filename and version field.
- A `backend/version.py` file (or similar) that the `GET /health` endpoint
  returns: `{"status": "ok", "version": "1.2.3"}`.

---

## GitHub Actions Workflows

### 5.1 — `ci.yml` — Continuous Integration

Runs on every push and pull request.

**Jobs:**

| Job | Runner | Steps |
|-----|--------|-------|
| `backend-test` | `ubuntu-latest` | Install Python deps, run `pytest` |
| `frontend-test` | `ubuntu-latest` | `npm ci`, `npm run lint`, `npm test` |
| `docker-build` | `ubuntu-latest` | `docker build .` (no push) |

---

### 5.2 — `release.yml` — Release Build

Triggered by a tag push (`refs/tags/v*`).

**Jobs (run in parallel after CI passes):**

#### Job: `docker`

Runner: `ubuntu-latest`

Steps:
1. Check out code.
2. Extract version from tag.
3. Log in to GHCR (`docker login ghcr.io`).
4. Build multi-platform image (linux/amd64 + linux/arm64) using
   `docker buildx`.
5. Push with tags:
   - `ghcr.io/<org>/trustytrack:<major>.<minor>.<patch>`
   - `ghcr.io/<org>/trustytrack:<major>.<minor>`
   - `ghcr.io/<org>/trustytrack:latest`
6. Update `docker-compose.yml` example in the release notes.

#### Job: `macos-dmg`

Runner: `macos-latest`

Steps:
1. Set up Python (via `actions/setup-python`).
2. Install Node.js (via `actions/setup-node`).
3. Install `create-dmg` via Homebrew.
4. Install PyInstaller: `pip install pyinstaller`.
5. Build frontend: `npm ci && npm run build`.
6. Run `packaging/build-mac.sh`.
7. Upload `TrustyTrack-<version>-mac.dmg` as a build artifact.

Optional: code-sign and notarize if `APPLE_CERT_P12` and
`APPLE_NOTARIZATION_PASSWORD` secrets are set (skip gracefully if not).

#### Job: `windows-exe`

Runner: `windows-latest`

Steps:
1. Set up Python and Node.js.
2. Install PyInstaller and Inno Setup.
3. Build frontend.
4. Run `packaging/build-windows.ps1`.
5. Upload `TrustyTrack-<version>-setup.exe` as a build artifact.

#### Job: `create-release`

Depends on all three jobs above.

Steps:
1. Download all build artifacts.
2. Create a GitHub Release using `gh release create`:
   - Tag: `v<version>`
   - Title: `Trusty Track v<version>`
   - Body: generated from `CHANGELOG.md` or a release notes template.
   - Attach: `.dmg`, `-setup.exe`, `docker-compose.yml`.
3. Post a comment summarizing what was built.

---

### 5.3 — `docker-compose.yml` in Releases

The GitHub Release should include a ready-to-use `docker-compose.yml` with
the pinned image tag for that version:

```yaml
services:
  app:
    image: ghcr.io/org/trustytrack:1.2.3
    ports:
      - "8000:8000"
    volumes:
      - trustytrack_data:/data
    environment:
      - TRUSTYTRACK_DATA_DIR=/data
    restart: unless-stopped

volumes:
  trustytrack_data:
```

This makes it trivial for Docker users to pin to a specific version.

---

### 5.4 — Release Checklist (Manual Steps)

Even with full automation, some steps remain manual:

- [ ] Update `CHANGELOG.md` with the changes since the last release.
- [ ] Bump version in `backend/version.py` (or automate with
  `bump-my-version` / `bumpversion`).
- [ ] Create and push the git tag:
  ```bash
  git tag v1.2.3
  git push origin v1.2.3
  ```
- [ ] After the pipeline completes, verify the GitHub Release page has all
  three artifacts attached.
- [ ] Test the Docker image on a fresh machine.
- [ ] Test the macOS `.dmg` on macOS 13+ and macOS 14+.
- [ ] Test the Windows `.exe` on Windows 10 and Windows 11.

---

### 5.5 — Secrets Required

| Secret name | Used by | Description |
|-------------|---------|-------------|
| `GHCR_TOKEN` | docker job | GitHub PAT with `write:packages` scope |
| `APPLE_CERT_P12` | macos-dmg job | Base64-encoded Developer ID certificate (optional) |
| `APPLE_CERT_PASSWORD` | macos-dmg job | Certificate password (optional) |
| `APPLE_NOTARIZATION_PASSWORD` | macos-dmg job | App-specific password for notarytool (optional) |
| `APPLE_TEAM_ID` | macos-dmg job | Apple Developer Team ID (optional) |

---

## Definition of Done

- [ ] `ci.yml` passes on all PRs to `main`.
- [ ] `release.yml` triggers on `v*` tags and produces all three artifacts.
- [ ] GitHub Release page is populated automatically with a `.dmg`, a `.exe`
  installer, and a `docker-compose.yml`.
- [ ] Docker image is available on GHCR with correct tags.
- [ ] `docker pull ghcr.io/<org>/trustytrack:latest && docker compose up`
  works for Docker users.
