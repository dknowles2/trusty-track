"""What a desktop certificate must cover after #723 (mDNS, stage 1).

`packaging/cert_requirements.py` holds the rule; these tests exercise it
directly by loading the file rather than `import`ing it as
`packaging.cert_requirements` (there is no `__init__.py`, deliberately — see
the module's own docstring) or importing `packaging.run_server` (which runs
real side effects — creating a platform data directory, generating a TLS
certificate, importing uvicorn and the whole backend — at module scope,
wrong for a unit test).
"""

import importlib.util
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "packaging" / "cert_requirements.py"
)


def _load_cert_requirements():
    spec = importlib.util.spec_from_file_location("cert_requirements", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cert_requirements = _load_cert_requirements()


def test_required_names_are_localhost_and_the_mdns_hostname():
    assert cert_requirements.required_dns_names() == frozenset(
        {"localhost", "trustytrack.local"}
    )


def test_an_old_certificate_with_only_localhost_does_not_cover_the_requirement():
    # The exact shape of a certificate #723 lands on top of: every install
    # made before this change has one of these, cached for up to ten years.
    assert cert_requirements.covers_required_names(["localhost"]) is False


def test_a_certificate_naming_both_covers_the_requirement():
    assert (
        cert_requirements.covers_required_names(["localhost", "trustytrack.local"])
        is True
    )


def test_extra_names_do_not_disqualify_a_certificate():
    # The LAN IP's own DNS-shaped names (there are none — it is an
    # `IPAddress` SAN entry, not a `DNSName`), or anything else a future SAN
    # entry adds, must not make an otherwise-covering certificate look
    # invalid.
    assert (
        cert_requirements.covers_required_names(
            ["localhost", "trustytrack.local", "some-future-name.local"]
        )
        is True
    )


def test_order_does_not_matter():
    assert (
        cert_requirements.covers_required_names(["trustytrack.local", "localhost"])
        is True
    )


def test_missing_the_mdns_hostname_alone_fails():
    names = ["localhost", "example.com"]
    assert cert_requirements.covers_required_names(names) is False


def test_an_empty_certificate_fails():
    assert cert_requirements.covers_required_names([]) is False
