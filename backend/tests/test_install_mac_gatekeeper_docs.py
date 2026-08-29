"""macOS 15 (Sequoia) removed the right-click Gatekeeper bypass.

`docs/user/install-mac.md` used to tell every reader — regardless of macOS
version — to right-click TrustyTrack and choose Open. That stopped working on
Sequoia, where the only route is System Settings -> Privacy & Security ->
Open Anyway, so the guide dead-ended readers on current Macs at the exact
screen that already worries a novice (#475).

This pins the fix at the doc-content level: both paths must be present and
each labelled with the macOS versions it applies to, so a future edit that
collapses them back into one set of instructions fails here rather than
shipping unnoticed.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INSTALL_MAC = REPO_ROOT / "docs" / "user" / "install-mac.md"


def _gatekeeper_section() -> str:
    text = INSTALL_MAC.read_text()
    match = re.search(
        r"### If you see a Gatekeeper security warning\n(.*?)(?=\n## |\n---)",
        text,
        re.S,
    )
    assert match, (
        "the Gatekeeper section heading has moved or been reworded in "
        "docs/user/install-mac.md; point this test at the new anchor rather "
        "than deleting it"
    )
    return match.group(1)


def test_the_pre_sequoia_right_click_path_is_labelled():
    section = _gatekeeper_section()
    assert re.search(r"macOS 12.*(?:through|to|-|–).*14", section), (
        "the right-click bypass must be labelled as applying to macOS 12-14 "
        "only -- it stopped working on macOS 15 (Sequoia)"
    )
    assert "Right-click" in section or "right-click" in section


def test_the_sequoia_system_settings_path_is_documented():
    section = _gatekeeper_section()
    assert "macOS 15" in section and "Sequoia" in section, (
        "the guide must call out macOS 15 (Sequoia) by name -- it is the "
        "version where the documented steps changed"
    )
    assert "System Settings" in section
    assert "Privacy & Security" in section
    assert "Open Anyway" in section, (
        "System Settings > Privacy & Security > Open Anyway is the only "
        "Gatekeeper bypass macOS 15 and later offer"
    )
