"""Advertising this machine as `trustytrack.local` over mDNS (#723, stages 1–2).

Every screen that is not the operator's own laptop needs the same thing: an
address that opens Trusty Track from *another* device. Today that means
leaving the app — `ipconfig`, a Mac's Wi-Fi details panel, `hostname -I` —
reading four numbers off it, and typing them into every display and tablet by
hand, an address a DHCP lease can change out from under by the next morning.
`scripts/install-pi.sh` already solves this for the Pi: it installs
`avahi-daemon` and sets the hostname to `trustytrack`, so the Pi has answered
for `trustytrack.local` since that script shipped. This module is what does
the same job on macOS, Windows and Docker, where there is no avahi to lean on.

Not fighting avahi on Linux
----------------------------
The Pi install already runs avahi, which already answers for
`trustytrack.local` from the hostname alone. A second responder bound over
the top of it is, at best, redundant probing and announcement traffic for a
name the network is already being told about, and at worst a genuine RFC 6762
conflict — two hosts both claiming an address record for the same name.
Issue #723 names three ways to handle this, in the order they should be tried:
detect the existing responder and stand down; register through avahi's D-Bus
API; or accept `python-zeroconf`'s `SO_REUSEADDR` coexistence with evidence
that it is actually fine.

This picks the first. There is no real Bookworm Pi in this environment to
measure the third option on (no root, no systemd — see
`avahi_already_running` below), and #723 is explicit that this is a thing to
measure rather than reason about, so it is not the one taken. The second
needs a D-Bus dependency this project carries nowhere else, for a problem the
first solves without one.

`avahi_already_running` is the stand-down check. Avahi's own Debian packaging
(inspected by extracting the `avahi-daemon` `.deb` with `dpkg-deb`, not by
running it — there is neither root nor systemd here to start it under) shows
it writes its PID to `/run/avahi-daemon/pid` and its control socket to
`/run/avahi-daemon/socket`, both created by `avahi-daemon -s` on start; the
PID file is the simpler of the two to check (a number to read, rather than a
protocol to speak) and needs no new dependency. A missing file, a stale one
naming a PID that is no longer running, and avahi never having been installed
at all are all the same answer — "nothing is using this name" — which is
also what a bare CI runner reports, so there is no separate "installed but
not running" branch to get wrong.

python-zeroconf has no API to publish a bare hostname
-------------------------------------------------------
Read directly from the installed library (0.151.3), not assumed: `ServiceInfo`
has no `hostname` concept anywhere in it, and the `server` field — the name
that actually becomes the address record people type into a browser — is set
once, by `set_server_if_missing`, *before* the probe that might rename
anything ever runs (`async_register_service` in `_core.py`). The library's
own collision handling (`register_service(..., allow_name_change=True)`) only
ever renames the *service instance* name; nothing after a rename touches
`server`. Home Assistant, which wants the same "publish my hostname" behaviour
this module does, sidesteps the whole question by using a random UUID as its
`server` value — collision-proof by construction, at the cost of not being a
name a person would type.

That is not good enough here: the point is exactly `trustytrack.local`, a name
a person types. So `register` (below) drives its own retry instead of
trusting the field the library has already frozen: it gives every attempt an
*identical*, fixed service name (`_SERVICE_TYPE`), which means two Trusty
Track instances that both want `HOSTNAME` collide with each other on that
name for the same reason they collide on the hostname itself, and it moves
`server` in lock-step with whichever numbered attempt actually wins the
library's real probe-and-announce cycle (confirmed directly: two independent
`Zeroconf()` instances on loopback, one registering `trustytrack` and a
second attempting the same name a second later, produce a genuine
`NonUniqueNameException` on the second — see `test_discovery.py`).

`_SERVICE_TYPE` is a private vehicle for this, not the browsable service
record — that was stage 2's job, kept deliberately separate. It is spelled
`_tt-host`, not `_trustytrack-mdns`, because RFC 6763 caps a service type
label at 15 bytes and the obvious name is one byte over.

Stage 2: two browsable records, riding on the hostname stage 1 already won
--------------------------------------------------------------------------
Be honest about who this is for: no mainstream browser can browse DNS-SD, so
this buys the volunteer nothing on its own — the user-visible win is
entirely stage 1's hostname. This is for the desktop app's own window,
third-party network tooling, and any future "find my instance" helper.

`_HTTP_SERVICE_TYPE` (`_http._tcp`, TXT `path=/`) is the ordinary
"there is a web server here" record a generic mDNS browser already
understands. `_TRUSTYTRACK_SERVICE_TYPE` (`_trustytrack._tcp`) is ours,
carrying `version` and `configured` so a future helper can tell an
unconfigured install apart from a running race without loading the page
first.

Both are registered only *after* stage 1's own retry loop has already
settled on a winning candidate name, using that name as the instance name
for each — there is no separate collision negotiation to run, because the
hostname's own uniqueness on this LAN already stands in for it: nothing else
here calls itself `trustytrack`. `allow_name_change=True` all the same,
since the browsable *instance* name (unlike `server`) is nobody's business
but this registration's own, and there is no plan to build stage 1's kind of
retry logic twice for something nobody reads back.

Deliberately best-effort past that point: a failure registering either
record is logged and swallowed rather than undoing the hostname claim
stage 1 already won. The issue says outright that this is cheap once stage
1's responder exists and should be dropped if it complicates stage 1 — the
version actually built keeps the two decoupled instead, which costs nothing
stage 1 was not already going to pay for a responder object it has to keep
around regardless.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from pathlib import Path

from zeroconf import NonUniqueNameException, ServiceInfo, Zeroconf

from backend import demo_mode
from backend.services.network import lan_addresses

logger = logging.getLogger(__name__)

#: The short hostname this app always asks for first. Fixed, matching what
#: `scripts/install-pi.sh` already sets the Pi's own hostname to — a
#: colliding second instance gets a numeric suffix (see `register`), never a
#: different base name; naming the instance after the organization was
#: considered and rejected in #723 itself, since discovery has to work
#: before the first-run wizard has created one.
HOSTNAME = "trustytrack"

#: A private, internal-only service type — see the module docstring for why
#: this exists and why it is not `_http._tcp`.
_SERVICE_TYPE = "_tt-host._tcp.local."

#: Stage 2's two browsable records (see the module docstring). `_http._tcp`
#: is the ordinary "there is a web server here" type a generic mDNS browser
#: already understands; `_trustytrack._tcp` is ours. Both ride on the
#: hostname `_SERVICE_TYPE` already won — see `_register_browsable_record`.
_HTTP_SERVICE_TYPE = "_http._tcp.local."
_TRUSTYTRACK_SERVICE_TYPE = "_trustytrack._tcp.local."

#: How many numbered names to try (`trustytrack`, `trustytrack-2`, ...) before
#: giving up and reporting failure. Two real instances on one LAN is the
#: case this exists for; five is generous headroom past that without turning
#: a genuinely saturated namespace into a long hang.
_MAX_ATTEMPTS = 5

#: The environment variable. Unlike `TRUSTYTRACK_DEMO_MODE` and
#: `TRUSTYTRACK_HTTP_ONLY`, *advertising* is the default here — mDNS is meant
#: to work with no configuration on every platform — so this is an opt-out,
#: not an opt-in: `TRUSTYTRACK_MDNS=off` (or any of `_FALSY` below) turns it
#: off for an operator who wants it off on a real install. Demo mode's
#: refusal, below, is separate and unconditional: it is not something this
#: variable can override back on.
MDNS_VARIABLE = "TRUSTYTRACK_MDNS"

_FALSY = frozenset({"off", "0", "false", "no"})

#: Where avahi writes its PID once running, per its own Debian packaging.
#: A module-level path (rather than a literal inside the function) so a test
#: can point `avahi_already_running` at a fixture file instead of the real
#: `/run`.
AVAHI_PID_FILE = Path("/run/avahi-daemon/pid")


def mdns_enabled() -> bool:
    """Whether this process should advertise itself over mDNS at all.

    Read from the environment on every call, the same shape as
    `backend.demo_mode.enabled()` — a test can flip it with
    `monkeypatch.setenv` and it is false again afterwards. See
    `MDNS_VARIABLE`'s own comment for why *on* is the default here, unlike
    every other flag this project reads this way.
    """
    return os.environ.get(MDNS_VARIABLE, "").strip().lower() not in _FALSY


def avahi_already_running(pid_file: Path | None = None) -> bool:
    """Whether an avahi-daemon on this machine is already answering for us.

    See the module docstring for where `/run/avahi-daemon/pid` comes from
    and why standing down is stage 1's answer to avahi rather than fighting
    it for the port. `os.kill(pid, 0)` sends no signal — it only asks the
    kernel whether the process exists — so this never touches avahi itself,
    only whether the file naming it is current.

    `pid_file` defaults to `None` and falls back to the *module-level*
    `AVAHI_PID_FILE` inside the body — not bound as this parameter's default
    value — for the same reason `start()`'s `zeroconf_factory` does: a
    default argument is evaluated once, at import time, before a test's
    `monkeypatch.setattr(discovery, "AVAHI_PID_FILE", ...)` has a chance to
    run, so `start()`'s own no-argument call here would otherwise never see
    a patched path.
    """
    path = pid_file if pid_file is not None else AVAHI_PID_FILE
    try:
        pid = int(path.read_text().strip())
    except (OSError, ValueError):
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Exists, owned by another user (root, ordinarily) — still running.
        return True
    except OSError:
        return False
    return True


class MdnsResponder:
    """A live registration, and the name it actually ended up with.

    `start()` is the only thing that creates one, and only once a name has
    actually been claimed — there is no "pending" or "failed" instance to
    hold, which is what keeps `hostname` non-optional here: a caller holding
    an `MdnsResponder` at all means the name it names is live.

    `infos` holds every record actually registered — always the stage 1
    hostname vehicle, plus whichever of stage 2's two browsable records did
    not fail (see the module docstring: those are best-effort, so this list
    can be shorter than three). `stop()` unregisters all of it.
    """

    def __init__(
        self, zeroconf: Zeroconf, infos: list[ServiceInfo], hostname: str
    ) -> None:
        self._zeroconf = zeroconf
        self._infos = infos
        #: The name actually registered, e.g. `"trustytrack.local"` or
        #: `"trustytrack-2.local"` on a colliding LAN — never the name that
        #: was merely *asked for*, per #723's first rule.
        self.hostname = hostname

    def stop(self) -> None:
        """Unregister and close. Safe to call from `main.py`'s shutdown path
        even if the process is exiting uncleanly — best-effort, since there
        is nobody left to read a failure here."""
        for info in self._infos:
            try:
                self._zeroconf.unregister_service(info)
            except Exception:
                logger.exception(
                    "Could not unregister an mDNS service (%s).", info.type
                )
        try:
            self._zeroconf.close()
        except Exception:
            logger.exception("Could not close the mDNS responder.")


def _candidate_port() -> int:
    """Best-effort only: this labels the internal vehicle service (see the
    module docstring), which nothing user-facing reads yet. `PORT` is the
    convention `Dockerfile` and `packaging/run_server.py` already use;
    `scripts/serve.sh` does not set it and hardcodes 8005 instead, so this
    can be wrong there. That is a pre-existing inconsistency in how the
    port is discovered at all, not something stage 1 introduces."""
    try:
        return int(os.environ.get("PORT", "8000"))
    except ValueError:
        return 8000


def _register_browsable_record(
    zeroconf: Zeroconf,
    service_type: str,
    candidate: str,
    server: str,
    port: int,
    addresses: list[str],
    properties: dict[str, str],
) -> ServiceInfo | None:
    """One of stage 2's two records, riding on the hostname `candidate` that
    stage 1's own retry loop already won — see the module docstring for why
    there is no separate collision negotiation here. Returns the registered
    `ServiceInfo`, or `None` if this particular record could not be
    registered; a failure here is logged and swallowed rather than raised,
    since it must never undo the hostname claim stage 1 already made.
    """
    info = ServiceInfo(
        service_type,
        f"{candidate}.{service_type}",
        parsed_addresses=addresses,
        port=port,
        server=server,
        properties=properties,
    )
    try:
        # `allow_name_change=True`, unlike stage 1's own registration: unlike
        # `server`, nothing reads this *instance* name back, so a collision
        # (some other device also calling itself "trustytrack" over this
        # service type) can be resolved however the library likes.
        zeroconf.register_service(info, allow_name_change=True)
    except Exception:
        logger.exception("Could not register %s over mDNS.", service_type)
        return None
    return info


def start(
    zeroconf_factory: Callable[[], Zeroconf] | None = None,
    *,
    configured: bool = False,
    version: str = "unknown",
) -> MdnsResponder | None:
    """Advertise `HOSTNAME.local` on the LAN, or decline honestly.

    Returns `None` — never a responder claiming a name nobody confirmed —
    when: demo mode is on (`demo_mode.enabled()`; there is no LAN to
    multicast onto, see `backend/demo_mode.py`); `TRUSTYTRACK_MDNS` is set to
    something falsy; avahi is already answering for this machine
    (`avahi_already_running`); this machine has no LAN address to publish
    (`lan_addresses()` came back empty); or every numbered attempt at a
    unique name collided or otherwise failed. A caller that gets `None` back
    falls back to showing an IP address exactly as it always has (#414) —
    that is the whole point of reporting failure as `None` rather than
    guessing.

    `configured` and `version` are stage 2's `_trustytrack._tcp` payload —
    whether an `Organization` row exists yet, and the running app version.
    Neither changes whether registration is attempted or what hostname is
    claimed; they only ride along on a record that a failure to register
    never blocks stage 1 on (see `_register_browsable_record`).

    `zeroconf_factory` exists so a test can supply a fake rather than a real
    `Zeroconf()`, which binds a UDP socket and joins a multicast group the
    moment it is constructed — `backend/tests/conftest.py`'s
    `no_real_mdns` replaces the module-level `Zeroconf` name itself for
    exactly that reason, the same shape `no_real_serial_ports` uses for
    `services.timer.probe`. Referencing the (possibly-patched) module-level
    name here, rather than binding it as this parameter's default value, is
    what lets that monkeypatch take effect: a default argument is evaluated
    once, at import time, before any fixture has run.
    """
    if demo_mode.enabled():
        logger.info("Demo mode: not advertising over mDNS.")
        return None
    if not mdns_enabled():
        logger.info("%s is set: not advertising over mDNS.", MDNS_VARIABLE)
        return None
    if avahi_already_running():
        logger.info(
            "avahi-daemon is already running; not starting a second mDNS responder."
        )
        return None

    addresses = lan_addresses()
    if not addresses:
        logger.info("No LAN address found; not advertising over mDNS.")
        return None

    factory = zeroconf_factory or Zeroconf
    zeroconf = factory()
    port = _candidate_port()

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        candidate = HOSTNAME if attempt == 1 else f"{HOSTNAME}-{attempt}"
        info = ServiceInfo(
            _SERVICE_TYPE,
            f"{candidate}.{_SERVICE_TYPE}",
            parsed_addresses=addresses,
            port=port,
            server=f"{candidate}.local.",
        )
        try:
            zeroconf.register_service(info, allow_name_change=False)
        except NonUniqueNameException:
            continue
        except Exception:
            logger.exception("Could not register %s.local over mDNS.", candidate)
            zeroconf.close()
            return None
        logger.info("Advertising this machine as %s.local", candidate)

        server = f"{candidate}.local."
        infos = [info]
        for service_type, properties in (
            (_HTTP_SERVICE_TYPE, {"path": "/"}),
            (
                _TRUSTYTRACK_SERVICE_TYPE,
                {"version": version, "configured": "true" if configured else "false"},
            ),
        ):
            browsable = _register_browsable_record(
                zeroconf, service_type, candidate, server, port, addresses, properties
            )
            if browsable is not None:
                infos.append(browsable)

        return MdnsResponder(zeroconf, infos, f"{candidate}.local")

    logger.warning(
        "Could not find a free mDNS name in %d attempts starting from %s.local; "
        "not advertising.",
        _MAX_ATTEMPTS,
        HOSTNAME,
    )
    zeroconf.close()
    return None
