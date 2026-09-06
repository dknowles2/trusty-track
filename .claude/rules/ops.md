# Backup, networking, the Raspberry Pi image, and the first-run gate

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `services/backup.py`, the backup endpoints, HTTPS/`TRUSTYTRACK_HTTP_ONLY`, `services/discovery.py`/mDNS, `deploy/raspberry-pi/`, `scripts/install-pi.sh`, or the first-run gate.

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

### Finding the instance: mDNS

`backend/services/discovery.py` (#723, stages 1-2 — a fourth stage,
documentation, is #723's own remaining item). The same reasoning as
`networkAddresses` (#414) one level up: an operator otherwise finds this
machine's address by leaving the app — `ipconfig`, a Mac's Wi-Fi details
panel, `hostname -I` — and typing four numbers a DHCP lease can change out
from under them into every display and tablet by hand. `scripts/install-pi.sh`
already solves this for the Pi by installing `avahi-daemon` and setting the
hostname to `trustytrack`; this module does the same job on macOS, Windows
and Docker, where there is no avahi to lean on, by registering
`trustytrack.local` over mDNS with `python-zeroconf`.

**Not fighting avahi on Linux.** The Pi install already runs avahi, which
already answers for `trustytrack.local` from the hostname alone — a second
responder bound over the top of it is at best redundant probing and
announcement traffic, at worst a genuine RFC 6762 conflict. `discovery.avahi_already_running()`
stands down rather than risk either: it reads `/run/avahi-daemon/pid`, the
file avahi's own Debian packaging writes on start (inspected from the `.deb`
with `dpkg-deb`, not run — there was neither root nor systemd available to
start it under, and the issue is explicit that this wants measuring on a
real Bookworm Pi rather than reasoning about, so the option chosen is the
one that needed no such measurement). A missing file, a stale one naming a
dead PID, and avahi never having been installed at all all mean the same
thing — nothing is answering for the name — which is also what a bare CI
runner reports. The two other options the issue named were rejected for
concrete reasons rather than by default: registering through avahi's D-Bus
API needs a dependency this project carries nowhere else, and accepting
`python-zeroconf`'s `SO_REUSEADDR` coexistence needs the same hardware
measurement this environment could not do.

**`python-zeroconf` has no API to publish a bare hostname.** Read directly
from the library's source (0.151.3), not assumed: `ServiceInfo.server` — the
field that becomes the address record a person actually types — is set
once, before any conflict probe runs, and the library's own collision
handling (`register_service(..., allow_name_change=True)`) only ever renames
the *service instance* name, never `server`. Home Assistant, wanting the
same "publish my hostname" behaviour, sidesteps this by using a random UUID
as its `server` value — collision-proof, but not a name a person would type,
which is the opposite of the point here. `discovery.start()` instead drives
its own retry: every attempt gets an *identical* fixed service type/name
(`_tt-host._tcp.local.` — 15-byte RFC 6763 label limit, one byte under
`_trustytrack-mdns`), so two Trusty Track instances that both want
`HOSTNAME` collide on that name for the same reason they collide on the
hostname itself, and `server` moves in lock-step with whichever numbered
attempt (`trustytrack`, `trustytrack-2`, ...) actually wins the library's
real probe-and-announce cycle. This is a private vehicle, not the browsable
service record — that is stage 2's job, immediately below.

**Stage 2 rides on the hostname stage 1 already won, rather than negotiating
its own name.** `_register_browsable_record` registers `_http._tcp` (TXT
`path=/`, the ordinary "there is a web server here" record any generic mDNS
browser already understands) and `_trustytrack._tcp` (TXT `version` and
`configured`, ours) using the exact `candidate` string that already survived
stage 1's collision loop — there is no second retry to write, because the
hostname's own uniqueness on this LAN already stands in for one: nothing
else here calls itself `trustytrack`. `allow_name_change=True` for both,
unlike stage 1's own registration, since nothing reads either *instance*
name back the way `MdnsResponder.hostname` is read. Be honest about who
this is for, per the issue: no mainstream browser can browse DNS-SD, so
this buys the volunteer nothing on its own — it is for the desktop app's
own window (`packaging/run_server.py`'s tray/menu-bar, below), third-party
network tooling, and any future "find my instance" helper.

**Best-effort, deliberately past the point of the hostname claim.** A
failure registering either browsable record is logged and swallowed —
`_register_browsable_record` returns `None` rather than raising — so it can
never undo the `.local` name stage 1 already won; `MdnsResponder.infos`
holds however many of the three records actually succeeded (always at
least the hostname vehicle), and `stop()` unregisters exactly that list.
`configured`/`version` are supplied by `main.py`'s lifespan — a quick
`Organization` existence check and `backend.version.__version__` — inside
the same broad `try` that already wraps `discovery.start()`, so a failure
reading either falls back to `False`/`"unknown"` rather than skipping
registration altogether.

**It reports the name it actually got, never the name it asked for.**
`MdnsResponder.hostname` only exists once a name has actually been claimed —
`trustytrack.local` on an uncontested LAN, `trustytrack-2.local` behind a
colliding instance — mirroring `networkAddresses`'s own `reachable` flag: a
name nobody confirmed must never be shown as though it worked.

**A failure reports `None`, and the caller already knows what to do with
that.** `discovery.start()` returns `None` — never a half-registered
responder — when demo mode is on (there is no LAN to multicast onto),
`TRUSTYTRACK_MDNS` is set to something falsy (`off`/`0`/`false`/`no` — an
*opt-out*, unlike `TRUSTYTRACK_DEMO_MODE`/`TRUSTYTRACK_HTTP_ONLY`, since
advertising is meant to work with no configuration on every platform), avahi
already answers, this machine has no LAN address (`lan_addresses()` came
back empty), or five numbered attempts all collided or failed outright.
Every one of those is the existing "show an IP instead" fallback — exactly
what stage 3 (below) leans on.

**The suite must never multicast on the real network.** `conftest.py`'s
autouse `no_real_mdns` replaces the module-level `Zeroconf` name
`discovery.py` resolves at call time (not a bound default argument — see
`start()`'s own docstring for why that distinction matters) with something
that raises, the same shape `no_real_serial_ports` uses for
`services.timer.probe`. A test exercising `discovery.start()` for real
passes its own fake `zeroconf_factory`, exactly as a serial test passes its
own `open_port`. Tests that merely run the real lifespan incidentally
(`test_init_db.py`, `test_demo_mode.py`) are unaffected: the resulting
`AssertionError` is caught by `main.py`'s own broad `except Exception`
around `discovery.start()`, leaving `MDNS_RESPONDER` at `None` —
indistinguishable from an ordinary machine on which mDNS declined to
register.

**The certificate has to cover the name it advertises, and the cache does
not update itself.** `packaging/run_server.py`'s `_ensure_cert()` caches its
self-signed certificate for ten years, so an install upgrading into this
holds a certificate that has never heard of `trustytrack.local` — and a
browser's reaction to a certificate naming the wrong host is a *worse*
warning than the ordinary self-signed one every install guide already walks
a reader past, sometimes with no "proceed anyway" at all. `_cert_is_valid()`
now also checks the certificate's SAN list against
`packaging/cert_requirements.py`'s `required_dns_names()`
(`{"localhost", "trustytrack.local"}`), so an old certificate is regenerated
once rather than trusted forever. `cert_requirements.py` is a tiny pure
sibling module, the same shape `http_mode.py` and `log_viewer.py` already
are — `run_server.py` generates its certificate *before* importing the
backend at all, so this deliberately does not import
`backend.services.discovery.HOSTNAME` to build its literal; the two are kept
in step by hand.

**Docker gets no mDNS, quietly.** `lan_addresses()`'s outbound-socket trick
still works inside a bridge-networked container, but the resulting
advertisement generally cannot reach the host's LAN — a container's own
network namespace is not the one phones on the venue wifi are joined to.
This is not specially detected or refused; it falls out of the existing
rules (no avahi in the image, so `avahi_already_running()` is `False`; the
registration may succeed from the container's own point of view, or simply
never be seen by anything outside it) rather than needing a
Docker-specific branch, and the Dockerfile's own served scheme and CORS
defaults are unaffected either way.

**Stage 3 surfaces the hostname, and reads it off `main.py`'s own global
rather than storing a second copy.** `Query.mdns_hostname` in `schema.py`
returns `info.context["mdns_hostname"]`, which `get_graphql_context` sets
fresh on every request/subscription from `MDNS_RESPONDER.hostname` — the
same module-level global `TIMER_MANAGERS` already rides on. Deliberately
its own field, not folded into `networkAddresses`: that query returns a
list of plain IPv4 addresses whose only consumer takes `[0]`, and a
hostname in it would be a string that happens to parse differently, the
stringly-typed shape this project keeps removing (#5). Null covers every
reason stage 1's `start()` might have declined, and — like
`networkAddresses`'s own `reachable` flag — it is never the name merely
*asked* for.

**`features/core/shareAddress.ts`'s `shareUrl` takes the hostname as a
fourth, optional argument and prefers it over a bare `networkAddresses`
entry whenever the backend has one** — it survives the DHCP lease change
that strands an IP-based address, where a `.local` name does not. This
does not change what `reachable` means: a registered hostname is exactly
as unconfirmed-for-this-specific-phone as a guessed IP always was (mDNS
registration proves this *server* answered on its own segment, not that
every phone in the room can resolve `.local` — some Android below 12
cannot, and some guest networks block multicast the same way they isolate
clients), so both kinds of substitution report the same flag. Both of
`shareUrl`'s existing callers (`BallotShare.tsx`, `QRCodeDisplayView.tsx`)
now pass `mdnsHostname` alongside `networkAddresses`, off the same
`NETWORK_ADDRESSES_QUERY`/`ObservationNetworkAddresses` documents both
already ran, widened to ask for the new field too.

**Race Control → Displays gets the same address, not only the ballot** —
`ConnectDisplayAddress.tsx` (`features/observation/components/`) is the
same Copy-button-and-QR-code shape as `BallotShare.tsx`, pointed at this
race's own Live view (`qrTargetPath('STANDINGS', raceId)`) rather than the
voting ballot, since setting up a wall display or a check-in tablet is the
*first* thing an operator reaches for a shareable address, before the
ballot's share step. It is a sibling component rather than a shared one
with `BallotShare.tsx`: the two differ in target path, wording, and
`BallotShare`'s own "Project QR code" button, which has no equivalent here.

**The desktop launcher's tray/menu-bar icon shows it too, read off its own
in-process backend module.** `packaging/run_server.py` imports
`backend.api.main` as `_backend_main` (alongside the existing `_app`
import) and `_network_label()` reads `_backend_main.MDNS_RESPONDER` fresh
on every call — never cached, since the lifespan sets it asynchronously
after the tray/menu-bar has already been constructed. macOS's `rumps`
needs an explicit refresh (`_update_status` now updates a stored
`self._network_item.title` alongside the existing status label, on every
status change so a restart's fresh registration is picked up); Windows'
`pystray` needs none — it already re-reads a callable title on every menu
open, the same shape the status label there already uses, so the network
row became `pystray.MenuItem(lambda _item: _network_label(), None)` with
no new wiring.

### The pre-built Raspberry Pi image (stages 1–2 of #724)

`deploy/raspberry-pi/`, mirroring how `deploy/cloudrun/` holds that platform's deployment. [#724](https://github.com/dknowles2/trusty-track/issues/724) is a `.img.xz` a volunteer writes with Raspberry Pi Imager and boots with no terminal at all — the documented `install-pi.sh` path costs 10–15 minutes rebuilding on the Pi itself, entirely artefacts CI could have built for the release. Stage 1 was the build and its two cheap test layers only: no role chooser, no kiosk mode, no release wiring, no QEMU boot test. Stage 2 (below) adds the last two of those; the role chooser and kiosk mode are still later stages of the same issue.

**It is `pi-gen` against Raspberry Pi OS Lite, 64-bit, Bookworm — the exact base `install-pi.sh` already targets**, plus one custom stage (`stage-trustytrack/`) that bakes in a built frontend and an installed venv, so the image boots straight into a working install with none of the on-Pi build. `deploy/raspberry-pi/build.sh`'s own header comment is the "flags are the documentation" precedent `deploy/cloudrun/deploy.sh` set, extended: it explains why pi-gen runs inside its own Docker container, why the application source is bind-mounted into that container rather than copied into the pi-gen checkout, and why pi-gen itself is a pinned commit fetched fresh rather than vendored.

**It reuses `install-pi.sh` rather than reimplementing "what a working install is" a second time.** That file is now *sourced* by the pi-gen stage as well as executed on a live Pi — a source-safe guard at its very end (`(return 0 2>/dev/null)`, not a `${BASH_SOURCE[0]} == ${0}` comparison, which gets the `curl | bash` case wrong: there is no source file at all in a pipe, so that comparison would wrongly think it had been sourced) means `main` only runs when the script is actually executed. `install_service` was split into itself (copy the unit, `chmod`, `systemctl enable`) and a new `start_service` (`daemon-reload` + `restart`), because a pi-gen chroot has no running systemd to restart against but `systemctl enable` writes its `multi-user.target.wants/` symlink straight to disk with no daemon needed — the same mechanism every pi-gen image's own `regenerate_ssh_host_keys` enablement already relies on. `main` calls both, in the same order, so a live install is unchanged. The one function the image build never calls is `setup_tls`: a public image is downloaded by everybody, so a certificate baked into it would be a private key every install shared. `scripts/pi-firstboot.sh` and `scripts/trustytrack-firstboot.service` exist for exactly that gap — a oneshot unit, ordered before `trustytrack.service` by that service's own `After=`, that sources `install-pi.sh` and calls `setup_tls` for real, once, the first time the image actually boots on hardware. (`trustytrack.service`'s `After=` names a unit that does not exist on a live install; systemd ignores an ordering dependency on a unit that is simply absent, so one shared unit file serves both paths.)

**"Ship prebuilt" is a build-then-strip shape, not a curated package list.** `install_system_packages` installs Node (from NodeSource, exactly as a live install does), `git` and `python3-pip` along with everything else it always has — none of those three are actually needed here (there is no `git clone`; the source arrives via the bind mount, and a venv's own pip comes from `python3-venv`'s bundled `ensurepip`) — and `03-cleanup` purges `nodejs`/`npm`/`git` afterward rather than a hand-picked install list trying to skip them up front. A second, divergent package list is exactly the shape #48 keeps naming: something to keep in step with `install_system_packages` by a person remembering. `python3-pip` and `gnupg` (pulled in by NodeSource's own setup script) are deliberately left in place — neither is the build toolchain the issue is about, and apt's own repository-signature verification depends on `gpgv`, not the full `gnupg` package, so removing it buys nothing.

**Two test layers, run at two different times:**

- **Layer A, inside the chroot, at build time** (`stage-trustytrack/04-verify/00-run.sh`): the venv can `import backend.api.main`, `frontend/dist/index.html` exists, `systemd-analyze verify` accepts both units, and — the inverse check that matters most — `node`, `npm` and `git` are no longer on `PATH`. A pi-gen build that "succeeds" while missing the app is the single most likely failure mode, and this is what turns it into a build failure instead of a working-looking image that silently is not.
- **Layer B, against the finished artefact, without booting it**: `deploy/raspberry-pi/verify-rootfs.sh` re-asserts the same shape of thing (plus that both units are actually *enabled* — the `multi-user.target.wants/` symlink, not merely the unit file existing) over a plain directory tree, so it needs no image, no mount and no root; `verify-image.sh` is the thin wrapper that loop-mounts a real `.img`/`.img.xz`'s root partition and hands it that directory, for whenever a real build exists to check. `backend/tests/test_pi_image_layer_b.py` exercises `verify-rootfs.sh` directly against a synthetic tree built by the test itself — both the pass case and each specific failure (missing venv, missing frontend build, an unenabled service, a leftover `node`/`npm`/`git`) — which is the "stubbed mount" this project's testing conventions favour over not testing an image-inspection script at all.

**Stage 2 wires the build into `release.yml` and adds the QEMU boot smoke test — a third layer, not a replacement for A or B.** The `raspberry-pi` job `needs: create-release` rather than the other way around: the release it attaches the image to has to exist first, and nothing needs `raspberry-pi`, so a slow or failed image build can never hold up the installers or the release page — the `deploy-demo` shape, generalised, and the reason is identical (a Cloud Run outage must not hold up a release; a stuck emulated pi-gen build must not either). A tag whose `docker`/`macos-dmg`/`windows-exe`/`create-release` chain fails skips `raspberry-pi` too, by the ordinary "a job with a failed dependency does not run" rule — no `if:` needed, unlike `deploy-demo`, which runs in *parallel* with `create-release` and so does need one for the opposite reason (it must not wait on a release that might never be published). Budget for the wait: pi-gen under QEMU/binfmt emulation is tens of minutes, same as stage 1 said it would be, and this is the first time anything in CI has actually measured it (see the note on that below).

**`deploy/raspberry-pi/qemu-boot-smoke-test.sh` is layer C: it boots the actual artefact**, not the chroot layer A checked or the mounted-but-unbooted rootfs layer B checked. It hands the *whole* raw image to QEMU's generic `virt` machine as a virtio-blk device (so the guest sees the same partition table and PARTUUIDs `/etc/fstab` already names, just a different transport), extracts `kernel8.img` from the boot partition to satisfy `-kernel` (a real Pi's firmware reads `config.txt`/`cmdline.txt`; QEMU has none of that, so `-append` supplies the kernel command line directly and the image's own `cmdline.txt` is never consulted), and gets a console for free because the Raspberry Pi kernel carries `VIRTIO_BLK`, `VIRTIO_NET` and `SERIAL_AMBA_PL011` built in rather than as loadable modules — the thing that makes this work with no initramfs and no Pi-specific device tree at all, since Raspberry Pi OS ships neither. It then polls `/health` and, critically, **checks the version in the answer against the version the image was built as** — the same trick `deploy-demo.yml` already uses against a Cloud Run revision that can otherwise serve traffic while quietly pinned to a stale one. The equivalent mistake here is an image built from the wrong ref, or one where `00-copy-source`'s version stamp silently didn't take; either way the server would still answer *something*; only the version check catches it.

**What layer C does not, and cannot, prove.** A generic QEMU `virt` machine shares no silicon with a real Pi: boot firmware, GPIO, USB serial timers, the touchscreen and SD card behaviour are all completely untested. The image ships smoke-tested, not hardware-tested — the same footing this project already states plainly for the DerbyNet timer profiles rather than implying support, and every place that describes this image to a reader should say so too.

**Neither PR that wrote the paragraphs above could run any of it for real** — no privileged Docker, no `qemu-system-aarch64`, no root, in the sandboxes both were written in — so both the pi-gen build and the QEMU boot test were reasoned from pi-gen's and the Raspberry Pi kernel's documented behaviour rather than a green run, right up until they merged. The de-risking follow-up split the build and boot test out of `release.yml` into their own callable workflow, **`.github/workflows/raspberry-pi-image.yml`**, which `release.yml`'s `raspberry-pi` job now calls via `workflow_call` instead of duplicating the steps — and which also carries a `workflow_dispatch` trigger, so the identical build can be run from the Actions tab with no tag and no release involved at all. Trigger it there (leave both inputs blank) to build the current `main` and boot-test it under QEMU; leave `tag` blank and the image comes back as a downloadable workflow artifact rather than a release asset, which is also the only route to actually trying a build on real hardware. **Running that workflow once is what finally establishes the facts asserted in the two paragraphs above** — the same "a performance number belongs to the machine it was measured on" caution `ci.md` already states for CI timings, extended here to correctness rather than speed. Until somebody has actually clicked Run workflow (or pushed a tag) since this was written, treat those two paragraphs as reasoned-but-unconfirmed still; a workflow existing to run something is not the same as it having run.

**Later stages** (unstarted): the first-boot role chooser and kiosk mode the top-level issue describes, and the user-facing docs for the image (deliberately not written yet — see [#473](https://github.com/dknowles2/trusty-track/issues/473)). The asset is uploaded as a fixed `TrustyTrack-raspberry-pi.img.xz` — no version in the name, unlike the macOS/Windows installers — precisely so a docs page can link `releases/latest/download/TrustyTrack-raspberry-pi.img.xz` (#474's pattern) without this workflow changing again; that name exists now even though nothing links to it yet.

**This is the one platform where both #723's mDNS mechanisms exist, so it is the one place their interaction can actually go wrong.** The image installs and enables `avahi-daemon` (via `install_system_packages` and `02-configure/00-run.sh`, reused from `install-pi.sh` exactly as everything else here is), which is what `discovery.avahi_already_running()` is supposed to find already answering for `trustytrack.local` before the Python `MdnsResponder` ever tries. But `avahi-daemon.service` and `trustytrack.service` are both plain `WantedBy=multi-user.target` with no ordering between them, so at boot they start in parallel — and `avahi-daemon.service` is `Type=dbus`, meaning systemd does not consider it "active" until it has claimed its D-Bus name, later than the moment it opens its actual listening socket and writes its PID file. Left alone, the Python responder can win that race and register `trustytrack.local` itself, and avahi's own later, genuine claim then reads as a conflict with a name this same machine already holds. `scripts/trustytrack.service` therefore carries `Wants=avahi-daemon.service` and `After=avahi-daemon.service` — `Wants=` rather than `After=` alone, because `After=` only orders units that are *already* part of the same start transaction for some other reason, and `Wants=` is what pulls `avahi-daemon.service` into a plain `systemctl restart trustytrack` too, which is exactly the sequence `install-pi.sh`'s own `main` runs on a first install (`start_service` runs before `setup_mdns` ever enables avahi). One unit file, reused by both paths, so the fix is not something the image alone got and a live install did not.

### First-run gate

`App.tsx` queries `initialConfig()`; if the system is unconfigured, all routes redirect to `/system-settings`, which creates the `Organization` and `Track`.
