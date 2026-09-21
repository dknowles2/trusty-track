"""`scripts/install-pi.sh`'s Node.js install step, tested in isolation.

dknowles2/trusty-track#1322: the v1.5.0 Pi image build reported
"[trustytrack] ✓ Node.js v18.20.4 OK" and then died 28 minutes later on
`npm: command not found`. NodeSource's own `setup_24.x` script ran its own
`apt update` inside a QEMU chroot, hit "Cannot allocate memory", printed
"Error: Failed to run 'apt update' (Exit Code: 0)" -- and still exited 0,
because the pipeline's status is `bash -`'s own (it ran to completion; it
just didn't do what it meant to). `apt-get install -y -q nodejs` then
happily installed Debian bookworm's own nodejs 18.20.4, which does not ship
`npm` at all (Debian packages it as a separate, merely "Suggested" package),
and the script printed success anyway: the version floor was only ever
checked *before* the install, never after.

`install_node` (`scripts/install-pi.sh`) and its `node_is_ok` helper are the
fix, used both to decide whether an install is needed at all and, again,
after installing, to decide whether to report success:

- `node_is_ok` requires *both* `node` and `npm` on PATH at major version
  >= 22 -- a Debian `nodejs` with no `npm` must fall into the install
  branch rather than being read as already fine.
- Between the `curl | bash -` step and `apt-get install nodejs`,
  `install_node` checks that NodeSource's setup script actually registered
  its apt source (`/etc/apt/sources.list.d/nodesource.sources`, confirmed
  by reading `setup_24.x`'s own text -- it *removes* the older
  `nodesource.list` on the way in, so checking for that name would never
  see the real file). `set -o pipefail` (already on, `install-pi.sh` line
  26) cannot catch `bash -`'s own successful exit here, so this is the
  actual, cheap thing to check instead of trusting the pipeline's status.
- After `apt-get install nodejs`, the exact same `node_is_ok` check runs
  again, and `install_node` refuses (via `error`, non-zero exit) rather
  than ever printing "OK" for a Node that still misses the floor.

Each case here sources the real, unmodified script (the same shape
`test_install_pi_sourceable.py` uses to prove sourcing runs no side
effects) and calls `install_node` under a `PATH` prefixed with shims for
`node`, `npm`, `curl` and `apt-get` -- no package is ever really installed,
`apt-get`/`curl` never touch the network, and `NODESOURCE_SOURCES_FILE`
(read by `install_node` in place of the real path, see the script's own
comment) points into a scratch directory rather than the real `/etc`.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent.parent / "scripts" / "install-pi.sh"


def _write_shim(bindir: Path, name: str, body: str) -> None:
    path = bindir / name
    path.write_text(f"#!/bin/bash\n{body}\n")
    path.chmod(0o755)


def _run_install_node(
    *,
    node_version: str,
    with_npm: bool,
    curl_registers: bool,
    apt_get_fixes_it: bool,
) -> tuple[subprocess.CompletedProcess[str], bool, bool]:
    """Source the real script and call `install_node` under a PATH of shims.

    Returns the completed process plus whether `curl` and `apt-get` (both
    shimmed) were actually invoked, so a test can check whether the
    network/package steps ran at all.
    """
    tmp = Path(tempfile.mkdtemp())
    try:
        bindir = tmp / "bin"
        bindir.mkdir()
        sources_file = tmp / "apt" / "nodesource.sources"
        curl_marker = tmp / "curl-called"
        apt_marker = tmp / "apt-get-called"

        _write_shim(bindir, "node", f'echo "{node_version}"')
        if with_npm:
            _write_shim(bindir, "npm", 'echo "9.0.0"')

        # `curl -fsSL <url> | bash -` in the real script: this shim stands
        # in for *both* halves at once (there is no separate file to pipe
        # into a real `bash -`), so it always exits 0 regardless of
        # `curl_registers` -- that is the whole point being tested:
        # NodeSource's own script can fail internally and still report
        # success to the pipeline.
        curl_body = f'touch "{curl_marker}"\n'
        if curl_registers:
            curl_body += f'mkdir -p "{sources_file.parent}"\n'
            curl_body += f'echo "Types: deb" > "{sources_file}"\n'
        curl_body += "cat >/dev/null\nexit 0\n"
        _write_shim(bindir, "curl", curl_body)

        apt_body = f'touch "{apt_marker}"\n'
        if apt_get_fixes_it:
            # Models a real `apt-get install nodejs` off a correctly
            # registered NodeSource repo: node and npm both land at the
            # requested major version. Rewrites the same `node` path
            # rather than a new one, so bash's command-path cache stays
            # valid.
            apt_body += f'printf \'echo "v24.0.0"\\n\' > "{bindir / "node"}"\n'
            apt_body += f'chmod +x "{bindir / "node"}"\n'
            apt_body += f'printf \'echo "10.0.0"\\n\' > "{bindir / "npm"}"\n'
            apt_body += f'chmod +x "{bindir / "npm"}"\n'
        apt_body += "exit 0\n"
        _write_shim(bindir, "apt-get", apt_body)

        env = {
            "PATH": f"{bindir}:/usr/bin:/bin",
            "NODESOURCE_SOURCES_FILE": str(sources_file),
        }
        result = subprocess.run(
            ["bash", "-c", f"source {SCRIPT} && install_node"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        # Markers are read by the caller after this function returns, so
        # copy their existence out before the scratch directory is removed
        # rather than returning paths that are about to stop existing.
        curl_called = curl_marker.exists()
        apt_called = apt_marker.exists()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return result, curl_called, apt_called


def test_nodesource_failing_to_register_is_refused_before_the_apt_install():
    """(a) Node v18, no npm; `curl | bash -` "succeeds" (exit 0) but never
    writes NodeSource's sources file -- the exact v1.5.0 failure. Must be
    refused with the NodeSource message, and never reach `apt-get install`."""
    result, curl_called, apt_called = _run_install_node(
        node_version="v18.20.4",
        with_npm=False,
        curl_registers=False,
        apt_get_fixes_it=False,
    )
    combined = result.stdout + result.stderr
    assert result.returncode != 0, combined
    assert "NodeSource did not register" in combined, combined
    assert curl_called, "curl should have run"
    assert not apt_called, (
        "apt-get install must not run once NodeSource failed to register"
    )


def test_a_still_broken_node_after_the_apt_install_is_refused():
    """(b) Node v18, no npm; NodeSource registers fine this time, but the
    apt-get install (Debian's own package, a pin problem, ...) still leaves
    Node below the floor with no npm. Must be refused, not reported OK."""
    result, curl_called, apt_called = _run_install_node(
        node_version="v18.20.4",
        with_npm=False,
        curl_registers=True,
        apt_get_fixes_it=False,
    )
    combined = result.stdout + result.stderr
    assert result.returncode != 0, combined
    assert "v18.20.4" in combined, combined
    assert "npm is missing" in combined, combined
    assert "✓ Node.js" not in combined, combined
    assert curl_called
    assert apt_called


def test_an_already_good_node_and_npm_skip_the_install_entirely():
    """(c) Node v24 with npm already on PATH: no network call, no apt-get,
    straight to success."""
    result, curl_called, apt_called = _run_install_node(
        node_version="v24.0.0",
        with_npm=True,
        curl_registers=True,
        apt_get_fixes_it=True,
    )
    combined = result.stdout + result.stderr
    assert result.returncode == 0, combined
    assert "✓ Node.js v24.0.0 OK" in combined, combined
    assert not curl_called, "a good node+npm must skip NodeSource entirely"
    assert not apt_called, "a good node+npm must skip apt-get entirely"


def test_a_node_with_no_npm_is_reinstalled_even_at_a_good_major_version():
    """(d) Node v24 already on PATH, but with no `npm` at all -- the exact
    shape a bare Debian `nodejs` package leaves. The install branch must
    still run (not skip on the node version alone), and here it succeeds."""
    result, curl_called, apt_called = _run_install_node(
        node_version="v24.0.0",
        with_npm=False,
        curl_registers=True,
        apt_get_fixes_it=True,
    )
    combined = result.stdout + result.stderr
    assert result.returncode == 0, combined
    assert "✓ Node.js v24.0.0 OK" in combined, combined
    assert curl_called, "a node with no npm must still trigger the install"
    assert apt_called


def test_a_node_below_the_floor_is_reinstalled_even_with_npm_present():
    """(e) Node v20 with `npm` beside it -- everything present, only the
    version short of the 22 floor. This is the case that pins the floor
    itself: every other refusal here is missing `npm`, so lowering the
    floor to 16 left them all passing (found in review). The install
    branch must run, and the post-install re-check must refuse when it
    leaves the version where it was."""
    result, curl_called, apt_called = _run_install_node(
        node_version="v20.19.0",
        with_npm=True,
        curl_registers=True,
        apt_get_fixes_it=False,
    )
    combined = result.stdout + result.stderr
    assert result.returncode != 0, combined
    assert "OK" not in combined, combined
    assert curl_called, "a node below the floor must trigger the install"
    assert apt_called
