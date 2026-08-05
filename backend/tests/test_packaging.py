"""The desktop packaging agrees with itself.

Three files have to name the same executable, and they are built by three
different tools on two operating systems: the PyInstaller spec names it, the
Inno Setup script makes every Windows shortcut point at it, and the release
workflow collects the artifacts. Nothing links them, so they drifted — the
installer created a Start-menu entry, a desktop icon and a "launch now"
checkbox all pointing at `TrustyTrack.exe`, which no build has ever produced.

A Windows installer that installs cleanly and then does nothing is exactly the
failure that gets past a green release job, because the build succeeded.

These are text checks. They cannot run PyInstaller or Inno Setup, and they are
not a substitute for installing the thing; they hold the names together, which
is where this went wrong.
"""

import re
from pathlib import Path

import pytest

PACKAGING = Path(__file__).resolve().parent.parent.parent / "packaging"

SPEC = PACKAGING / "trustytrack.spec"
INNO = PACKAGING / "TrustyTrack.iss"
WINDOWS_BUILD = PACKAGING / "build-windows.ps1"


@pytest.fixture(scope="module")
def spec_text() -> str:
    return SPEC.read_text()


@pytest.fixture(scope="module")
def inno_text() -> str:
    return INNO.read_text()


def _exe_name(spec_text: str) -> str:
    """The `name=` PyInstaller gives the EXE, which becomes `<name>.exe`."""
    match = re.search(r"^\s*name='([^']+)',\s*$", spec_text, re.M)
    assert match, "could not find the EXE name in trustytrack.spec"
    return match.group(1)


def test_the_installer_points_at_the_executable_that_gets_built(spec_text, inno_text):
    expected = f"{_exe_name(spec_text)}.exe"

    declared = re.search(r'#define MyAppExeName\s+"([^"]+)"', inno_text)
    assert declared, "TrustyTrack.iss does not define MyAppExeName"
    assert declared.group(1) == expected


def test_every_shortcut_uses_that_name(inno_text):
    """Nothing in the script may name an executable literally.

    The bug was one stale `#define`; hard-coding a filename in an `[Icons]` or
    `[Run]` line would put it back with the define still looking right.
    """
    literal_exes = {
        name
        for name in re.findall(r"Filename: \"\{app\}\\([^\"]+)\"", inno_text)
        if not name.startswith("{#")
    }
    assert literal_exes == set()


def test_the_installer_ships_only_the_bundle(inno_text):
    """No loose Python source.

    `launcher.py` used to be installed beside the frozen executable, on a
    machine with no Python to run it.
    """
    sources = re.findall(r"^Source: \"([^\"]+)\"", inno_text, re.M)
    assert sources, "the installer copies nothing"
    assert not [s for s in sources if s.endswith(".py")]


def test_the_bundle_path_is_where_pyinstaller_writes(spec_text, inno_text):
    """`COLLECT(name=...)` is the directory the installer reads."""
    collect_name = re.search(r"name='(\w+)',\s*\)\s*$", spec_text, re.M)
    assert collect_name, "could not find the COLLECT name in trustytrack.spec"

    bundle_dir = re.search(r'#define BundleDir\s+"([^"]+)"', inno_text)
    assert bundle_dir
    assert bundle_dir.group(1).endswith(collect_name.group(1))


def test_the_data_the_app_needs_at_runtime_is_bundled(spec_text):
    """Each of these is loaded from disk after freezing, so a missing entry is
    a crash on a user's machine rather than a build failure."""
    for needed in ("frontend/dist", "backend/assets", "backend/migrations"):
        assert needed in spec_text, f"{needed} is not in the PyInstaller datas"


def test_the_windows_build_script_is_ascii():
    """Windows PowerShell 5.1 reads a BOM-less UTF-8 file as Windows-1252.

    The box-drawing characters that used to separate this script's sections
    came back as three bytes whose middle one is a smart closing quote, and
    PowerShell treats that as a string delimiter — so every divider opened a
    string, and the script had never parsed on a stock Windows machine. It
    failed at a brace thirty lines below the real cause, which is why it
    survived two attempts to fix it by reading.
    """
    text = WINDOWS_BUILD.read_text(encoding="utf-8")

    offenders = sorted({character for character in text if ord(character) > 127})
    assert not offenders, (
        f"non-ASCII in build-windows.ps1: {offenders}. Windows PowerShell will "
        f"mis-decode these; keep the file ASCII or give it a BOM."
    )


def test_the_windows_build_script_has_no_here_strings():
    """A here-string terminator has to be alone on its line.

    One of these ended `"@ 2>$null`, which never closed the string and took the
    rest of the file with it.
    """
    lines = WINDOWS_BUILD.read_text(encoding="utf-8").splitlines()

    openers = [line for line in lines if line.rstrip().endswith('@"')]
    assert not openers, (
        f"here-strings in build-windows.ps1: {openers}. Pass a quoted string or "
        f"call a script file instead."
    )
