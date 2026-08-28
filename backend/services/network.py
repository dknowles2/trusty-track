"""Finding the addresses this machine can be reached at from off itself.

The voting page's share step showed `window.location.origin` next to "Share
this address for people to vote from their phones" (#414). On the machine
that runs Trusty Track — the documented setup — that is
`http://localhost:8000`, which names the machine from its own point of view
and nothing else can open. The browser has no way to do better: it cannot see
its own LAN address any more than the phone can resolve `localhost` to
someone else's machine. The backend can — it is the thing bound to the
network — so this is what the frontend asks instead of trying to work it out
from `window.location`.

Best-effort, deliberately. There is no dependency here beyond the standard
library, and no technique for discovering "my LAN address" is guaranteed on
every OS and network shape a Pi or a laptop might be running on. A machine
with no usable answer gets an empty list back, and the caller has to say so
rather than show `localhost` as though it worked.
"""

from __future__ import annotations

import socket

#: Addresses that never help a phone on the venue wifi: loopback (only this
#: machine), and link-local (only sent when nothing better exists, and rarely
#: routed the way an operator would expect).
_UNREACHABLE_PREFIXES = ("127.", "169.254.")


def lan_addresses() -> list[str]:
    """Every IPv4 address this machine is plausibly reachable at, sorted.

    Two techniques, combined, because neither alone is reliable everywhere:

    - `socket.gethostbyname_ex` resolves the machine's own hostname, which is
      normally its advertised LAN address — but can come back empty, or
      loopback-only, on a host whose `/etc/hosts` or DHCP lease is unusual.
    - Opening a UDP socket to a public address and reading `getsockname()`
      never actually sends a packet (UDP is connectionless), but it makes the
      OS pick the interface it would route through — normally the Wi-Fi or
      Ethernet adapter — which catches what the hostname trick misses.

    Both are wrapped in `OSError` handling: a machine with no network at all
    (or one where either call is simply unsupported) answers with whatever the
    other technique found, or an empty list if neither did.
    """
    addresses: set[str] = set()

    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        addresses.update(ips)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass

    return sorted(
        addr for addr in addresses if not addr.startswith(_UNREACHABLE_PREFIXES)
    )
