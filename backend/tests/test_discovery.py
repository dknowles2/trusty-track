"""Advertising this machine over mDNS (#723, stages 1-2).

`backend/services/discovery.py` holds the rule; these tests exercise it
directly. `conftest.py`'s autouse `no_real_mdns` replaces the module-level
`Zeroconf` name with something that raises, so every test here either checks
a short-circuit that never reaches it (demo mode, `TRUSTYTRACK_MDNS=off`,
avahi already running, no LAN address) or passes its own fake
`zeroconf_factory` — the same shape a serial timer test passes its own
``open_port`` to ``probe.detect`` rather than touching a real port.

Stage 1 registers one record — the internal `_tt-host` hostname vehicle.
Stage 2 adds two more (`_http._tcp`, `_trustytrack._tcp`) once that one has
won a name, best-effort. Most of the tests below predate stage 2 and only
care about the hostname vehicle, so they select it out of `fake.registered`
by type rather than assuming it is the only thing there.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

from backend import demo_mode
from backend.services import discovery


class FakeServiceInfo:
    """Stands in for `zeroconf.ServiceInfo` well enough for a fake registrar
    to inspect what it was asked to publish."""

    def __init__(self, type_, name, **kwargs):
        self.type = type_
        self.name = name
        self.server = kwargs.get("server")
        self.port = kwargs.get("port")
        self.parsed_addresses = kwargs.get("parsed_addresses")
        self.properties = kwargs.get("properties")


class FakeZeroconf:
    """A fake registrar.

    `rejected_names` is the set of *candidate hostnames* (`"trustytrack"`,
    `"trustytrack-2"`, ...) that should behave as already taken — this is
    the fake's proxy for "another instance already claimed this on the
    LAN", since real conflict detection is exactly what `no_real_mdns`
    exists to keep out of the suite. `rejected_types` is stage 2's own
    knob: a service *type* whose registration should always fail, however
    the hostname negotiation went — the fake's proxy for stage 2's
    best-effort record failing without touching the hostname vehicle at all.
    """

    def __init__(
        self,
        rejected_names: frozenset[str] = frozenset(),
        rejected_types: frozenset[str] = frozenset(),
    ):
        self.rejected_names = rejected_names
        self.rejected_types = rejected_types
        self.registered: list[FakeServiceInfo] = []
        self.unregistered: list[FakeServiceInfo] = []
        self.closed = False

    def register_service(self, info, allow_name_change=False):  # noqa: ARG002
        if info.type in self.rejected_types:
            raise RuntimeError(f"{info.type} is rejected in this test")
        candidate = info.server.removesuffix(".local.")
        if candidate in self.rejected_names:
            from zeroconf import NonUniqueNameException

            raise NonUniqueNameException
        self.registered.append(info)

    def unregister_service(self, info):
        self.unregistered.append(info)

    def close(self):
        self.closed = True


def _by_type(fake: FakeZeroconf, service_type: str) -> list[FakeServiceInfo]:
    return [info for info in fake.registered if info.type == service_type]


def _patch_service_info(monkeypatch):
    """`ServiceInfo` itself is real (imported at module scope from a real
    library, not stubbed by `no_real_mdns`) — only `Zeroconf()` touches the
    network, and `FakeServiceInfo` is plenty to assert against without
    constructing the real, more particular one (RFC 6763 name-length
    limits, address encoding, ...)."""
    monkeypatch.setattr(discovery, "ServiceInfo", FakeServiceInfo)


# ── mdns_enabled ─────────────────────────────────────────────────────────


def test_mdns_is_on_by_default(monkeypatch):
    monkeypatch.delenv(discovery.MDNS_VARIABLE, raising=False)
    assert discovery.mdns_enabled() is True


@pytest.mark.parametrize("value", ["off", "OFF", "0", "false", "False", "no", " off "])
def test_recognised_falsy_values_turn_mdns_off(monkeypatch, value):
    monkeypatch.setenv(discovery.MDNS_VARIABLE, value)
    assert discovery.mdns_enabled() is False


@pytest.mark.parametrize("value", ["", "on", "please", "1", "true"])
def test_everything_else_leaves_mdns_on(monkeypatch, value):
    monkeypatch.setenv(discovery.MDNS_VARIABLE, value)
    assert discovery.mdns_enabled() is True


# ── avahi_already_running ────────────────────────────────────────────────


def test_no_pid_file_means_avahi_is_not_running(tmp_path):
    assert discovery.avahi_already_running(tmp_path / "does-not-exist") is False


def test_a_pid_file_naming_this_process_means_avahi_is_running(tmp_path):
    pid_file = tmp_path / "pid"
    pid_file.write_text(str(os.getpid()))
    assert discovery.avahi_already_running(pid_file) is True


def test_a_stale_pid_file_means_avahi_is_not_running(tmp_path):
    # A real, now-dead PID: spawn a subprocess and wait for it to exit.
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    pid_file = tmp_path / "pid"
    pid_file.write_text(str(proc.pid))
    assert discovery.avahi_already_running(pid_file) is False


def test_a_malformed_pid_file_means_avahi_is_not_running(tmp_path):
    pid_file = tmp_path / "pid"
    pid_file.write_text("not a pid\n")
    assert discovery.avahi_already_running(pid_file) is False


def test_an_empty_pid_file_means_avahi_is_not_running(tmp_path):
    pid_file = tmp_path / "pid"
    pid_file.write_text("")
    assert discovery.avahi_already_running(pid_file) is False


# ── start ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _real_lan_address(monkeypatch):
    """Every `start()` test below wants a LAN address available unless it is
    specifically testing the "none found" case; a fixed, fake one keeps
    these tests from depending on the sandbox's actual network shape."""
    monkeypatch.setattr(discovery, "lan_addresses", lambda: ["192.0.2.5"])


@pytest.fixture(autouse=True)
def _no_avahi(monkeypatch, tmp_path):
    """None of the `start()` tests below are about avahi coexistence —
    point the check at a file that will never exist."""
    monkeypatch.setattr(discovery, "AVAHI_PID_FILE", tmp_path / "no-avahi-here")


def test_demo_mode_advertises_nothing(monkeypatch):
    monkeypatch.setattr(demo_mode, "enabled", lambda: True)

    def refuse():
        raise AssertionError("demo mode must not even construct a Zeroconf()")

    assert discovery.start(zeroconf_factory=refuse) is None


def test_mdns_off_advertises_nothing(monkeypatch):
    monkeypatch.setenv(discovery.MDNS_VARIABLE, "off")

    def refuse():
        raise AssertionError("TRUSTYTRACK_MDNS=off must not construct a Zeroconf()")

    assert discovery.start(zeroconf_factory=refuse) is None


def test_avahi_already_running_stands_down(monkeypatch, tmp_path):
    pid_file = tmp_path / "pid"
    pid_file.write_text(str(os.getpid()))
    monkeypatch.setattr(discovery, "AVAHI_PID_FILE", pid_file)

    def refuse():
        raise AssertionError(
            "avahi is already running; must not construct a Zeroconf()"
        )

    assert discovery.start(zeroconf_factory=refuse) is None


def test_no_lan_address_advertises_nothing(monkeypatch):
    monkeypatch.setattr(discovery, "lan_addresses", lambda: [])

    def refuse():
        raise AssertionError("no LAN address; must not construct a Zeroconf()")

    assert discovery.start(zeroconf_factory=refuse) is None


def test_an_uncontested_name_registers_as_asked(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf()

    responder = discovery.start(zeroconf_factory=lambda: fake)

    assert responder is not None
    assert responder.hostname == "trustytrack.local"
    vehicle = _by_type(fake, discovery._SERVICE_TYPE)
    assert len(vehicle) == 1
    assert vehicle[0].server == "trustytrack.local."


def test_a_collision_reports_the_name_it_actually_got(monkeypatch):
    """The rule #723 states first: never claim the name that was merely
    *asked for*. `trustytrack` is taken, so the responder must report
    `trustytrack-2.local` — not `trustytrack.local`, and not a bare
    success with no name attached."""
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(rejected_names=frozenset({"trustytrack"}))

    responder = discovery.start(zeroconf_factory=lambda: fake)

    assert responder is not None
    assert responder.hostname == "trustytrack-2.local"


def test_several_collisions_keep_counting_up(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(
        rejected_names=frozenset({"trustytrack", "trustytrack-2", "trustytrack-3"})
    )

    responder = discovery.start(zeroconf_factory=lambda: fake)

    assert responder is not None
    assert responder.hostname == "trustytrack-4.local"


def test_a_saturated_namespace_reports_failure_and_closes(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(
        rejected_names=frozenset(
            {
                "trustytrack",
                "trustytrack-2",
                "trustytrack-3",
                "trustytrack-4",
                "trustytrack-5",
            }
        )
    )

    assert discovery.start(zeroconf_factory=lambda: fake) is None
    assert fake.closed is True


def test_an_unexpected_registration_failure_reports_null_and_closes(monkeypatch):
    _patch_service_info(monkeypatch)

    class ExplodingZeroconf(FakeZeroconf):
        def register_service(self, info, allow_name_change=False):  # noqa: ARG002
            raise RuntimeError("the multicast socket vanished")

    fake = ExplodingZeroconf()

    assert discovery.start(zeroconf_factory=lambda: fake) is None
    assert fake.closed is True


def test_stop_unregisters_and_closes(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf()

    responder = discovery.start(zeroconf_factory=lambda: fake)
    assert responder is not None

    responder.stop()

    assert len(fake.unregistered) == len(fake.registered)
    assert fake.closed is True


def test_stop_is_best_effort_if_unregister_raises(monkeypatch):
    _patch_service_info(monkeypatch)

    class RudeZeroconf(FakeZeroconf):
        def unregister_service(self, info):  # noqa: ARG002
            raise RuntimeError("already gone")

    fake = RudeZeroconf()
    responder = discovery.start(zeroconf_factory=lambda: fake)
    assert responder is not None

    responder.stop()  # must not raise

    assert fake.closed is True


def test_the_default_factory_is_refused_by_the_autouse_guard():
    """Confirms `no_real_mdns` actually does its job: calling `start()` with
    no fake at all must never reach a real `Zeroconf()`."""
    with pytest.raises(AssertionError, match="real Zeroconf"):
        discovery.start()


# ── stage 2: the browsable records ──────────────────────────────────────


def test_stage_2_registers_both_browsable_records_on_the_winning_name(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf()

    responder = discovery.start(
        zeroconf_factory=lambda: fake, configured=True, version="1.2.3"
    )

    assert responder is not None
    http = _by_type(fake, discovery._HTTP_SERVICE_TYPE)
    assert len(http) == 1
    assert http[0].server == "trustytrack.local."
    assert http[0].properties == {"path": "/"}

    tt = _by_type(fake, discovery._TRUSTYTRACK_SERVICE_TYPE)
    assert len(tt) == 1
    assert tt[0].server == "trustytrack.local."
    assert tt[0].properties == {"version": "1.2.3", "configured": "true"}


def test_stage_2_reports_an_unconfigured_install(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf()

    discovery.start(zeroconf_factory=lambda: fake, configured=False)

    tt = _by_type(fake, discovery._TRUSTYTRACK_SERVICE_TYPE)
    assert tt[0].properties["configured"] == "false"


def test_stage_2_rides_on_whichever_name_the_hostname_vehicle_actually_won(
    monkeypatch,
):
    """A collision on the hostname vehicle must carry through to the
    browsable records too — they name the same machine, so they had better
    agree on what it is called."""
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(rejected_names=frozenset({"trustytrack"}))

    responder = discovery.start(zeroconf_factory=lambda: fake)

    assert responder is not None
    assert responder.hostname == "trustytrack-2.local"
    browsable_types = (
        discovery._HTTP_SERVICE_TYPE,
        discovery._TRUSTYTRACK_SERVICE_TYPE,
    )
    for service_type in browsable_types:
        infos = _by_type(fake, service_type)
        assert len(infos) == 1
        assert infos[0].server == "trustytrack-2.local."


def test_stage_2_defaults_when_the_caller_supplies_nothing(monkeypatch):
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf()

    discovery.start(zeroconf_factory=lambda: fake)

    tt = _by_type(fake, discovery._TRUSTYTRACK_SERVICE_TYPE)
    assert tt[0].properties == {"version": "unknown", "configured": "false"}


def test_a_failed_browsable_record_does_not_undo_the_hostname_claim(monkeypatch):
    """Stage 2 is best-effort (see the module docstring): failing to
    register `_http._tcp` must not cost the operator the `.local` name
    stage 1 already won."""
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(rejected_types=frozenset({discovery._HTTP_SERVICE_TYPE}))

    responder = discovery.start(zeroconf_factory=lambda: fake)

    assert responder is not None
    assert responder.hostname == "trustytrack.local"
    assert _by_type(fake, discovery._HTTP_SERVICE_TYPE) == []
    assert len(_by_type(fake, discovery._TRUSTYTRACK_SERVICE_TYPE)) == 1


def test_stop_only_unregisters_what_actually_registered(monkeypatch):
    """Following on from the above: `stop()` must not choke on — or try to
    unregister — a record that never made it into `fake.registered`."""
    _patch_service_info(monkeypatch)
    fake = FakeZeroconf(rejected_types=frozenset({discovery._HTTP_SERVICE_TYPE}))

    responder = discovery.start(zeroconf_factory=lambda: fake)
    assert responder is not None

    responder.stop()  # must not raise

    assert len(fake.unregistered) == 2
    assert fake.closed is True
