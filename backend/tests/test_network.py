"""Finding the address the voting page's share step can offer a phone (#414).

`services.network.lan_addresses` is best-effort over two OS-dependent
techniques, so the unit tests fake `socket` rather than depending on this
machine's actual network. The GraphQL test at the bottom pins the query is
reachable and returns whatever the service finds, without caring what that is
on the machine running the suite.
"""

import socket

import pytest

from backend.services import network


class _FakeDatagramSocket:
    """Stands in for the `connect`-then-`getsockname` trick.

    A real UDP "connect" never sends a packet; it just makes the OS pick a
    route. Faked here as a context manager returning a fixed local address,
    or raising if the "network" is down.
    """

    def __init__(self, local_address):
        self._local_address = local_address

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def connect(self, _addr):
        if self._local_address is None:
            raise OSError("Network is unreachable")

    def getsockname(self):
        return (self._local_address, 0)


def _fake_socket_module(local_address):
    """A stand-in for `socket.socket(...)` that ignores its arguments and
    always hands back the same fake datagram socket."""

    def _socket(*_args, **_kwargs):
        return _FakeDatagramSocket(local_address)

    return _socket


def _raise_no_hostname(_host):
    raise OSError("Name or service not known")


class TestLanAddresses:
    def test_prefers_whatever_both_techniques_find(self, monkeypatch):
        monkeypatch.setattr(
            socket,
            "gethostbyname_ex",
            lambda _host: ("pi", [], ["192.168.1.42"]),
        )
        monkeypatch.setattr(socket, "socket", _fake_socket_module("192.168.1.42"))

        assert network.lan_addresses() == ["192.168.1.42"]

    def test_combines_addresses_from_both_techniques(self, monkeypatch):
        monkeypatch.setattr(
            socket,
            "gethostbyname_ex",
            lambda _host: ("pi", [], ["192.168.1.42"]),
        )
        monkeypatch.setattr(socket, "socket", _fake_socket_module("10.0.0.5"))

        assert network.lan_addresses() == ["10.0.0.5", "192.168.1.42"]

    def test_drops_loopback_addresses(self, monkeypatch):
        monkeypatch.setattr(
            socket, "gethostbyname_ex", lambda _host: ("pi", [], ["127.0.1.1"])
        )
        monkeypatch.setattr(socket, "socket", _fake_socket_module(None))

        assert network.lan_addresses() == []

    def test_drops_link_local_addresses(self, monkeypatch):
        """A self-assigned address (no DHCP server answered) is not the sort
        of thing worth handing a phone across the room."""
        monkeypatch.setattr(
            socket, "gethostbyname_ex", lambda _host: ("pi", [], ["169.254.3.4"])
        )
        monkeypatch.setattr(socket, "socket", _fake_socket_module(None))

        assert network.lan_addresses() == []

    def test_a_hostname_lookup_failure_falls_back_to_the_socket_trick(
        self, monkeypatch
    ):
        monkeypatch.setattr(socket, "gethostbyname_ex", _raise_no_hostname)
        monkeypatch.setattr(socket, "socket", _fake_socket_module("192.168.1.7"))

        assert network.lan_addresses() == ["192.168.1.7"]

    def test_no_network_at_all_answers_with_nothing(self, monkeypatch):
        monkeypatch.setattr(socket, "gethostbyname_ex", _raise_no_hostname)
        monkeypatch.setattr(socket, "socket", _fake_socket_module(None))

        assert network.lan_addresses() == []


@pytest.fixture
def stub_addresses(monkeypatch):
    monkeypatch.setattr(network, "lan_addresses", lambda: ["192.168.1.42"])


class TestQuery:
    def test_network_addresses_returns_what_the_service_finds(
        self,
        client,
        stub_addresses,  # noqa: ARG002 - applies via monkeypatch
    ):
        response = client.post("/graphql", json={"query": "{ networkAddresses }"})

        assert response.status_code == 200
        assert response.json()["data"]["networkAddresses"] == ["192.168.1.42"]

    def test_network_addresses_can_be_empty(self, client, monkeypatch):
        monkeypatch.setattr(network, "lan_addresses", lambda: [])

        response = client.post("/graphql", json={"query": "{ networkAddresses }"})

        assert response.json()["data"]["networkAddresses"] == []
