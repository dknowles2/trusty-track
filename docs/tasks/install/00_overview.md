# Installation Packaging — Overview [COMPLETED]

> **Built.** All five channels ship: source, Docker, Raspberry Pi, the
> macOS/Windows desktop apps, and the tagged release pipeline.

## Goal

Make Trusty Track easy to install for a wide range of users, from developers
who want to run from source, to pack admins who just want to click an installer
and go. This task group covers the engineering work and user documentation
needed to support each distribution channel.

---

## Audience Personas

| Persona               | Technical Level                                      | Goal                                        |
| --------------------- | ---------------------------------------------------- | ------------------------------------------- |
| **Developer**         | High — comfortable with Python, Node.js, Git         | Run from source; hack on the code           |
| **Self-hoster**       | Medium — comfortable with Docker and a terminal      | Run a stable instance on their own hardware |
| **Raspberry Pi user** | Low–medium — wants an appliance that boots and works | Plug in a Pi, open a browser, done          |
| **Mac user**          | Low — downloads apps from the internet               | Double-click a `.dmg` installer             |
| **Windows user**      | Low — downloads apps from the internet               | Run a `.exe` installer                      |

---

## Distribution Channels

| #        | Channel                       | Task File                  | Audience                             |
| -------- | ----------------------------- | -------------------------- | ------------------------------------ |
| 1 [COMPLETED] | From source                   | `01_from_source.md`        | Developers                           |
| 2        | Docker / Docker Compose       | `02_docker.md`             | Self-hosters, technically inclined   |
| 3        | Raspberry Pi                  | `03_raspberry_pi.md`       | "Appliance" users, embedded installs |
| 4        | Desktop app (macOS + Windows) | `04_desktop_app.md`        | Non-technical end users              |
| 5        | Release pipeline (CI/CD)      | `05_release_pipeline.md`   | Maintainers — builds all artifacts   |
| 6        | User-facing install docs      | `06_user_documentation.md` | Writers / doc maintainers            |

---

## Architectural Prerequisite: Unified Server Mode

All distribution channels except "from source" benefit from a **unified
server mode** where the FastAPI backend also serves the compiled React
frontend as static files. This collapses the two-process dev setup into a
single process/port that is much simpler to package and run.

### What it means in practice

- `npm run build` produces `frontend/dist/`.
- FastAPI mounts `frontend/dist/` under `StaticFiles` at `/` and serves
  `index.html` for unknown paths (client-side routing).
- The single binary/container only needs one open port (e.g. 8000).
- Dev mode (`--reload`, separate Vite server) is unchanged.

This is a **prerequisite** for Docker, Raspberry Pi, and desktop packaging.
See `01_from_source.md` for the code change needed.

---

## Shared Engineering Tasks

These are required by more than one channel and should be completed first:

1. **Unified server mode** — FastAPI serves the built frontend. (`01_from_source.md`)
2. **Configurable data directory** — The SQLite database and uploaded images
   should live in a user-writable location (e.g. `~/.trustytrack/` or a
   volume-mounted path), not inside the source tree. This is needed for Docker
   volumes, Pi persistence, and app bundles.
3. **Health check endpoint** — `GET /health` returns `{"status": "ok"}`.
   Used by Docker health checks, systemd `ExecStartPost`, and the desktop
   launcher to know when the backend is ready.
4. **Environment-based configuration** — Key settings (port, data dir,
   log level, TLS cert paths) should be readable from environment variables
   or a simple config file, so they can be overridden without editing source.

---

## Dependency Summary

```
01_from_source (unified server mode, configurable data dir)
    │
    ├──> 02_docker
    ├──> 03_raspberry_pi
    └──> 04_desktop_app
              │
              └──> 05_release_pipeline (builds all artifacts)
```

`06_user_documentation` is independent but should be written last so it
reflects the final UX of each channel.
