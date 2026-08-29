"""The Windows Firewall prompt is part of first launch, not a troubleshooting
case (#476).

`docs/user/install-windows.md` used to mention the firewall dialog only under
Troubleshooting -> "Other devices cannot reach the app" -- but the prompt
appears for *everyone*, mid-first-launch, right after Step 3's installer
finishes. A novice who has just been told the app needs no technical
knowledge sees an unfamiliar security dialog and, following the instinctive
move with scary dialogs, dismisses it -- silently losing the audience
displays and the second operator, discovered only on race day.

This pins the fix at the doc-content level: Step 4's happy path must mention
the prompt and tell the reader to click Allow, and the rule must live in
that one place -- the Troubleshooting entry should point back at Step 4
for the "why", not restate it, or the two will drift the way #475's Gatekeeper
section did.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INSTALL_WINDOWS = REPO_ROOT / "docs" / "user" / "install-windows.md"


def _section(heading_pattern: str) -> str:
    text = INSTALL_WINDOWS.read_text()
    match = re.search(
        rf"{heading_pattern}\n(.*?)(?=\n## |\n### |\n---)",
        text,
        re.S,
    )
    assert match, (
        f"a heading matching {heading_pattern!r} was not found in "
        f"{INSTALL_WINDOWS} -- point this test at the new anchor rather "
        "than deleting it"
    )
    return match.group(1)


def test_step_4_tells_the_reader_to_allow_the_firewall_prompt():
    section = _section(re.escape("## Step 4 — Use Trusty Track"))
    assert "firewall" not in section.lower() or "Windows will ask" in section, (
        "Step 4 should describe the firewall prompt in its own words -- "
        "check this test still matches the current phrasing"
    )
    assert re.search(r"allow.*trusty track.*network", section, re.I | re.S), (
        "Step 4's happy path must tell the reader Windows will ask to allow "
        "Trusty Track on the network -- this is what #476 moved out of "
        "Troubleshooting, since the prompt appears for every installer, not "
        "just the ones who later notice a display can't connect"
    )
    assert "**Allow**" in section, (
        "Step 4 must tell the reader to click Allow, not just describe the dialog"
    )


def test_troubleshooting_points_back_to_step_4_instead_of_repeating_it():
    section = _section(re.escape("### Other devices cannot reach the app"))
    assert "Step 4" in section, (
        "the Troubleshooting entry should reference Step 4 for the 'why', "
        "not re-explain the firewall prompt -- the rule belongs in one "
        "place (#476)"
    )
    restated = (
        "audience displays and any second operator connect over your local network"
    )
    assert restated not in section, (
        "the Troubleshooting entry has drifted back into restating Step 4's "
        "explanation instead of only covering the re-allow path"
    )
