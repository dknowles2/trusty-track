# Backup, networking, and the first-run gate

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `services/backup.py`, the backup endpoints, HTTPS/`TRUSTYTRACK_HTTP_ONLY`, or the first-run gate.

---

### Backup and restore

`backend/services/backup.py`, `GET /api/backup` and `POST /api/backup/restore`, the panel at the foot of System Settings. An archive is a zip of three things: a database snapshot, the uploads directory, and a `manifest.json`.

**The service imports nothing from the app.** It takes an engine and two directories, which is what lets a test run a real restore against a temporary data directory rather than the operator's own. Keep it that way — a restore is the one operation in the tree that overwrites everything, so it must be testable without pointing it at the install.

Four rules, each of which is a way of getting it wrong:

- **The snapshot goes through SQLite's backup API, never `shutil.copy`.** The app is serving while it runs and the timer writes through its own session (#9), so a file copy can catch a half-written page. The backup API takes a read lock and produces a database that opens.
- **Everything refusable is refused before anything moves.** The manifest is read, the schema revision is checked and every member is unpacked into staging *first*; only then is anything swapped. A damaged or too-new archive leaves the running event untouched, which is what `test_a_refusal_leaves_the_running_event_untouched` pins.
- **`dispose` runs between staging and the swap.** SQLAlchemy pools connections, and replacing the file underneath an open one leaves it addressing a database that no longer exists. `test_the_connection_pool_is_dropped_before_the_swap` asserts the ordering rather than the call.
- **A stale `-wal`/`-shm` beside a replaced database is a corrupt read, not an error.** They belong to the file that was just moved aside, so they are removed with it.

**Recognition is by Alembic revision, not by version number** (`database.known_revisions`). A *newer* archive holds a schema this install has no migrations for and no downgrade path back from, so it is refused; an *older* one is restored and then upgraded forward by `init_db()`, which is the path a legacy database already takes at startup. The revision comes out of the archived database rather than being asserted by the manifest.

**Member names are checked, not sanitised.** An archive arrives from whoever holds the operator PIN. A backup we wrote contains exactly three kinds of entry, so anything else — `uploads/../../etc/passwd` being the classic — is a reason to stop rather than to guess.

**Both endpoints check the role themselves.** `RolePolicyExtension` guards GraphQL mutations and these are not GraphQL, the same reason `/ws/timer/{track_id}` does its own. Operator-only in both directions: the archive holds every racer's name and photograph, and a restore replaces a running event.

**One level of undo, deliberately.** What is replaced is kept as `trusty-track.db.pre-restore` and `uploads.pre-restore/`. An unbounded history of 60-photo directories would fill the SD card the backup exists to protect.

### Networking: HTTPS by default, plain HTTP as an opt-out

HTTPS is forced on purpose (#593), not a default that happened to stick. `components/ui/CameraCapture.tsx` and the check-in scanner's `BarcodeDetector` (`features/printables/components/CheckInScanner.tsx`) only work in a browser **secure context**, and a browser only counts `https://` and the machine's own `localhost` as secure — a second device reached by plain `http://<lan-ip>` is not, whatever network it is on. So `packaging/run_server.py`, `scripts/serve.sh` and `scripts/install-pi.sh` all generate a self-signed certificate and serve `https://` everywhere, which is what lets those two features work off the machine running the server at all.

**The certificate is the cost of that.** Every browser rejects it as untrusted, and a venue with no volunteer willing to click through "Advanced → Proceed anyway" on a wall-mounted display or a borrowed check-in tablet finds the warning worse than losing the camera on those secondary devices would be.

**`TRUSTYTRACK_HTTP_ONLY` is the escape hatch, read at call time like `TRUSTYTRACK_DEMO_MODE`** (`packaging/http_mode.py`) — any truthy value serves plain HTTP instead: no certificate is generated, uvicorn gets no `--ssl-*` flags, and every URL the app shows (the launcher's `APP_URL`/`NETWORK_URL`, the Pi installer's final address, the health check) uses `http://`. **Off by default**, so an install that has never heard of it serves exactly what it always has — this is Option 1 from the issue, not a change of default; Option 2 (a local CA / `mkcert`, trusted with no per-device warning at all) is deliberately not built, and is named as a possible follow-up.

**One switch, honoured at every entry point**, because #48's lesson is that a rule reaching only the obvious call sites reaches only some of them:

- **`packaging/run_server.py`** (the macOS/Windows desktop launcher) reads the environment variable first; if absent, it falls back to a small persisted setting (`launcher_settings.json` in the data directory) that the tray/menu-bar's **Use Plain HTTP** toggle writes. Toggling asks for a full quit-and-reopen rather than an in-process restart — `APP_URL`, `NETWORK_URL` and whether a certificate exists are all resolved once, before uvicorn or the backend are even imported, and re-deriving them live (and reopening whatever browser tab is already pointed at the old scheme) is a great deal more machinery than telling the operator to restart the app they were about to quit and reopen for the setting to matter anyway.
- **`scripts/serve.sh`** and **`scripts/run_dev.sh`** check the variable directly and skip certificate generation and the `--ssl-*` flags when it is set; `run_dev.sh`'s HTTPS-only frontend variant (`:5174`, which exists to exercise the secure-context-only features against a real certificate) is skipped too in that mode, since there is no backend certificate left for it to proxy to.
- **`scripts/install-pi.sh`** reads it once at install time (`sudo TRUSTYTRACK_HTTP_ONLY=1 ./scripts/install-pi.sh` — `sudo` drops the caller's environment by default, so this is not something to `export` beforehand) and, if set, skips certificate generation and persists the flag into `/etc/trustytrack/env`, which the systemd unit's `EnvironmentFile=-` reads on every start — including after a reboot, where the install-time flag itself is long gone. The unit's `ExecStart=` points at `scripts/pi-start.sh` rather than a literal uvicorn command, because a `.service` file cannot express "pass `--ssl-*` only if a variable is set" — there is no conditional in `ExecStart=` — so the branch lives in a real shell instead.
- **Docker already serves plain HTTP unconditionally** (`Dockerfile`'s `CMD`) and needed no change — it never generated a certificate to begin with, which is why `install-docker.md`'s own camera note predates this issue.

**The rule — given the flag, which scheme and which uvicorn kwargs — is one pure function, tested with no server, no certificate and no environment at all** (`backend/tests/test_http_mode.py`, loading `packaging/http_mode.py` the same way `test_view_logs_command.py` loads `log_viewer.py`: by file path, not `import`, because `packaging/` has no `__init__.py` — PyPI's own `packaging` library is a common transitive dependency, and a real package here would shadow or collide with it — and because importing `run_server.py` itself runs real side effects, generating a certificate and importing the whole backend, at module scope).

**The frontend says what it is giving up, rather than failing silently or blaming permissions.** Both `CameraCapture.tsx` and `CheckInScanner.tsx` already caught the error `getUserMedia` throws outside a secure context — `navigator.mediaDevices` does not exist there at all — but the message ("Could not access camera. Please ensure permissions are granted.") sent a volunteer to check browser permissions for a problem that is actually about the connection. Both now check `window.isSecureContext === false` (never plain `!window.isSecureContext` — a real browser always reports a boolean, so this only fires on a genuine insecure origin, never on a test environment that has not implemented the property) before ever calling `getUserMedia`, and show a one-line explanation instead: open the site on the computer running the server, or switch HTTPS back on.

### First-run gate

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Organization` and `Track`.
