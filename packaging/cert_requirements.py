"""What a Trusty Track desktop certificate has to cover (#723).

`run_server.py`'s `_ensure_cert()` caches its self-signed certificate until
it expires (ten years), so widening what it covers does nothing for an
install that upgrades into a new requirement unless the *validity check*
also learns to ask for it — otherwise the old certificate keeps looking
valid, and the machine goes on answering `https://trustytrack.local:8000`
with a certificate that has never heard of that name. That is a *worse*
warning than the ordinary self-signed one every install guide already walks
a reader past: Chrome's `NET::ERR_CERT_COMMON_NAME_INVALID` offers no
"Proceed anyway" at all on some platforms, where a plain self-signed
mismatch does. The same class of mistake as the broken macOS code-signature
in #594 — a half-right credential is worse than an honestly absent one.

`MDNS_HOSTNAME` here is a fixed literal, not read from
`backend.services.discovery.HOSTNAME` — kept in sync by hand, the same
relationship `domain.name_display.format_display_name` has with its
JavaScript twin, because `run_server.py` deliberately generates its
certificate *before* importing the backend at all (`_ensure_cert()` runs
above the "Backend imports" comment in that file), and reaching into
`backend` from here to save one string literal would undo that ordering for
a two-line saving.

Kept as its own tiny pure module, sibling to `run_server.py` rather than a
function inside it, for the same reason `http_mode.py` and `log_viewer.py`
already are: importing `run_server` runs its module-level side effects —
creating the platform data directory, generating a TLS certificate,
importing uvicorn and the whole backend — at import time, which is wrong
for a unit test and unnecessary for exercising these two rules.
"""

from __future__ import annotations

from collections.abc import Iterable

#: The hostname `backend/services/discovery.py` asks mDNS to publish. Fixed,
#: not derived from a live registration result: a certificate is generated
#: once and cached for years, long before anyone knows whether *this* boot's
#: mDNS registration will succeed on this particular network — and an unused
#: SAN entry costs nothing, where a missing one is the failure this module
#: exists to prevent. Keep this in step by hand with
#: `backend.services.discovery.HOSTNAME` if that ever changes.
MDNS_HOSTNAME = "trustytrack.local"


def required_dns_names() -> frozenset[str]:
    """Every DNS name a valid desktop certificate's SAN list must contain.

    `"localhost"` is what the certificate has always covered; `MDNS_HOSTNAME`
    is #723's addition. The LAN IP is deliberately not part of this: it can
    change between runs (a new DHCP lease), so `_ensure_cert()` already
    regenerates around it separately rather than by asking whether the old
    one still covers today's address.
    """
    return frozenset({"localhost", MDNS_HOSTNAME})


def covers_required_names(existing_dns_names: Iterable[str]) -> bool:
    """Whether a certificate's own SAN DNS names already satisfy
    `required_dns_names()` — the pure half of `run_server.py`'s
    `_cert_is_valid()`, which reads the actual PEM file and calls this with
    what it found."""
    return required_dns_names().issubset(set(existing_dns_names))
