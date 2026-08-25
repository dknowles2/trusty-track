"""Which origins the browser may call this server from.

`allow_origins=["*"]` is correct on a LAN and explained at the call site: a
display or a phone on venue wifi loads the page from this origin, and the PIN
is what the server checks. On a public origin the reasoning does not hold —
`VIEWER` is the no-credential default and a viewer can read a roster, which is
every racer's name and their photograph.
"""

import pytest

from backend.api.main import allowed_origins


@pytest.fixture(autouse=True)
def _no_setting(monkeypatch):
    monkeypatch.delenv("TRUSTYTRACK_ALLOWED_ORIGINS", raising=False)


def test_the_default_is_the_wildcard():
    """Which is every install that exists, and every LAN install after this."""
    assert allowed_origins() == ["*"]


def test_one_origin(monkeypatch):
    monkeypatch.setenv("TRUSTYTRACK_ALLOWED_ORIGINS", "https://demo.example.org")

    assert allowed_origins() == ["https://demo.example.org"]


def test_several_origins_and_the_spaces_between_them(monkeypatch):
    monkeypatch.setenv(
        "TRUSTYTRACK_ALLOWED_ORIGINS",
        "https://demo.example.org, https://www.example.org",
    )

    assert allowed_origins() == ["https://demo.example.org", "https://www.example.org"]


@pytest.mark.parametrize("configured", ["", "   ", ",", " , "])
def test_an_empty_setting_falls_back_to_the_wildcard(monkeypatch, configured):
    """Not to an empty list, which refuses *every* cross-origin request.

    On a LAN install that is indistinguishable from the app being broken, and
    the likeliest way to arrive at one is a deployment setting the variable to
    an empty string — which means "I did not configure this", not "refuse
    everybody".
    """
    monkeypatch.setenv("TRUSTYTRACK_ALLOWED_ORIGINS", configured)

    assert allowed_origins() == ["*"]
