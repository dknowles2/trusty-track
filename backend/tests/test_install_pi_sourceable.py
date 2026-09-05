"""`scripts/install-pi.sh` is sourced by the Raspberry Pi image build
(deploy/raspberry-pi/, dknowles2/trusty-track#724 stage 1) as well as being
run directly on a live Pi. These tests pin the two things that split depends
on: sourcing it must not run `main` (no root check, no `apt-get`, nothing),
and every invocation shape it is actually used with — direct execution,
`bash script.sh`, and `curl | bash` — must still run `main` as before.

Nothing here runs `main` to completion (that needs root and a real Pi's
package set); each case only checks which branch of the guard at the bottom
of the script fired, via `require_root`'s own error message.
"""

import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent.parent / "scripts" / "install-pi.sh"


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, check=False)


def test_the_script_is_executable():
    assert SCRIPT.is_file()
    assert SCRIPT.stat().st_mode & 0o111


def test_sourcing_defines_functions_without_running_main():
    result = _run(
        [
            "bash",
            "-c",
            f"source {SCRIPT} && "
            "declare -F install_system_packages build_app setup_user_and_dirs "
            "setup_tls setup_env install_service start_service setup_mdns "
            "setup_hotspot main",
        ]
    )
    assert result.returncode == 0, result.stdout + result.stderr
    # `require_root`'s message is `main`'s first observable act; its absence
    # is what proves sourcing took the non-executing branch (the test suite
    # itself may or may not be root, so this cannot simply assert success).
    assert "must be run as root" not in result.stdout + result.stderr


def test_direct_execution_runs_main_and_hits_the_root_check():
    # Run as the test's own (non-root, in CI) user: main() should still be
    # reached, and require_root() should be what stops it.
    result = _run(["bash", str(SCRIPT)])
    assert result.returncode == 1
    assert "must be run as root" in result.stderr


def test_piped_execution_runs_main_and_hits_the_root_check():
    """`curl -fsSL ... | bash` — the script's own documented usage — has no
    source file at all from bash's point of view. This is exactly the case
    a naive `${BASH_SOURCE[0]} == ${0}` guard gets wrong (see the comment
    above the guard); `(return 0 2>/dev/null)` gets it right."""
    with SCRIPT.open() as f:
        script_text = f.read()
    result = subprocess.run(
        ["bash"],
        input=script_text,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "must be run as root" in result.stderr
