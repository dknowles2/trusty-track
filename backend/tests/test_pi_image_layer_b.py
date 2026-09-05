"""Test layer B for the Raspberry Pi image (dknowles2/trusty-track#724, stage 1).

`deploy/raspberry-pi/verify-rootfs.sh` is the half of layer B that makes no
assumption about how its directory tree arrived — a real image's mounted root
partition, or (here) a directory built by hand with nothing else in it. That
split is deliberate: a full pi-gen build needs Docker, QEMU and tens of
minutes, and `verify-image.sh` (the sibling script that loop-mounts a real
`.img`) needs root for the loop device, neither of which this suite can do.
What *can* run everywhere is the assertions themselves, against a synthetic
rootfs — the "stubbed mount" the task that added this file was asked to
prefer over not testing layer B at all.

These tests exercise the script as a subprocess rather than reimplementing
its checks in Python, for the same reason `test_docs_stay_current.py` renders
real Markdown instead of reasoning about it: the thing worth pinning is the
script that will actually run during a real build, not a second copy of what
it is supposed to do.
"""

import shutil
import subprocess
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parent.parent.parent
    / "deploy"
    / "raspberry-pi"
    / "verify-rootfs.sh"
)


def _run(rootfs: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), str(rootfs)],
        capture_output=True,
        text=True,
        check=False,
    )


def _write_executable(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(0o755)


def _build_good_rootfs(root: Path) -> None:
    """A rootfs with everything the script asks for, and nothing it refuses."""
    (root / "opt/trustytrack/frontend/dist").mkdir(parents=True)
    (root / "opt/trustytrack/frontend/dist/index.html").write_text("<html></html>")

    _write_executable(root / "opt/trustytrack/backend/venv/bin/python3")
    _write_executable(root / "opt/trustytrack/backend/venv/bin/uvicorn")
    _write_executable(root / "opt/trustytrack/scripts/pi-start.sh")

    systemd_dir = root / "etc/systemd/system"
    wants_dir = systemd_dir / "multi-user.target.wants"
    wants_dir.mkdir(parents=True)
    for unit in ("trustytrack.service", "trustytrack-firstboot.service"):
        (systemd_dir / unit).write_text("[Unit]\n")
        (wants_dir / unit).symlink_to(f"../{unit}")


def test_script_exists_and_is_executable():
    assert SCRIPT.is_file()
    assert SCRIPT.stat().st_mode & 0o111, "verify-rootfs.sh must be executable"


def test_a_well_formed_rootfs_passes(tmp_path):
    _build_good_rootfs(tmp_path)

    result = _run(tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "all checks passed" in result.stdout


def test_a_missing_frontend_build_fails(tmp_path):
    _build_good_rootfs(tmp_path)
    (tmp_path / "opt/trustytrack/frontend/dist/index.html").unlink()

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "frontend build is present" in result.stderr


def test_a_missing_venv_fails(tmp_path):
    _build_good_rootfs(tmp_path)
    (tmp_path / "opt/trustytrack/backend/venv/bin/uvicorn").unlink()

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "uvicorn" in result.stderr


def test_an_unenabled_service_fails(tmp_path):
    """The most likely pi-gen failure per CLAUDE.md: the unit file exists but
    was never `systemctl enable`d, so the app never starts at boot."""
    _build_good_rootfs(tmp_path)
    (
        tmp_path / "etc/systemd/system/multi-user.target.wants/trustytrack.service"
    ).unlink()

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "trustytrack.service is not enabled" in result.stderr


def test_a_unit_file_present_only_as_a_plain_file_is_not_enabled(tmp_path):
    """`systemctl enable` makes a symlink. A regular file at the same path —
    the shape a naive `cp` into `multi-user.target.wants/` would produce —
    must still fail: it is not what enabling a unit actually does."""
    _build_good_rootfs(tmp_path)
    symlink = (
        tmp_path / "etc/systemd/system/multi-user.target.wants/trustytrack.service"
    )
    symlink.unlink()
    symlink.write_text("[Unit]\n")

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "trustytrack.service is not enabled" in result.stderr


def test_node_present_on_path_fails(tmp_path):
    _build_good_rootfs(tmp_path)
    _write_executable(tmp_path / "usr/bin/node")

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "node is still present" in result.stderr


def test_npm_present_on_path_fails(tmp_path):
    _build_good_rootfs(tmp_path)
    _write_executable(tmp_path / "usr/local/bin/npm")

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "npm is still present" in result.stderr


def test_git_present_on_path_fails(tmp_path):
    _build_good_rootfs(tmp_path)
    _write_executable(tmp_path / "usr/bin/git")

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "git is still present" in result.stderr


def test_git_recorded_installed_in_dpkg_status_fails(tmp_path):
    """Belt and braces beside the PATH check: `dpkg`'s own database is asked
    too, in case a package left a binary somewhere the PATH check does not
    look."""
    _build_good_rootfs(tmp_path)
    dpkg_dir = tmp_path / "var/lib/dpkg"
    dpkg_dir.mkdir(parents=True)
    (dpkg_dir / "status").write_text(
        "Package: git\nStatus: install ok installed\nVersion: 1:2.39.2-1\n"
        "\n"
        "Package: unrelated-package\nStatus: install ok installed\nVersion: 1.0\n"
    )

    result = _run(tmp_path)

    assert result.returncode != 0
    assert "git is still recorded as installed in dpkg" in result.stderr


def test_a_dpkg_status_with_no_matching_package_passes(tmp_path):
    """A dpkg database that simply never had node/npm/git in it (the normal
    case for a real image once 03-cleanup has run) must not be treated as a
    failure merely because the file exists."""
    _build_good_rootfs(tmp_path)
    dpkg_dir = tmp_path / "var/lib/dpkg"
    dpkg_dir.mkdir(parents=True)
    (dpkg_dir / "status").write_text(
        "Package: unrelated-package\nStatus: install ok installed\nVersion: 1.0\n"
    )

    result = _run(tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr


def test_shellcheck_is_clean_if_available():
    """Advisory rather than a hard requirement — shellcheck is not one of
    this project's declared dependencies, so a machine without it must not
    fail the suite. Where it is available (it is, in CI's Docker Build
    runner image family and on most developer machines), it should stay
    clean at warning severity or higher."""
    shellcheck = shutil.which("shellcheck")
    if shellcheck is None:
        return

    deploy_dir = SCRIPT.parent
    scripts = [
        deploy_dir / "build.sh",
        deploy_dir / "verify-rootfs.sh",
        deploy_dir / "verify-image.sh",
        *sorted((deploy_dir / "stage-trustytrack").glob("*/00-run.sh")),
        deploy_dir / "stage-trustytrack" / "prerun.sh",
    ]

    result = subprocess.run(
        [shellcheck, "--severity=warning", *[str(s) for s in scripts]],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
