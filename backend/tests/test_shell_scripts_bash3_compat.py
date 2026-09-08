"""Every shell script under `scripts/` and `packaging/` must run under bash
3.2 — the version macOS ships at `/bin/bash`, and what `#!/usr/bin/env bash`
resolves to on a Mac with no Homebrew bash installed over it
(dknowles2/trusty-track#891). Case-modification parameter expansion
(`${var,,}`, `${var^^}`, and their single-character `${var,}`/`${var^}`
forms) is bash 4 syntax; 3.2 rejects it at evaluation time with "bad
substitution" — which is what broke `TRUSTYTRACK_HTTP_ONLY` parsing
(#639) in `scripts/serve.sh`, `scripts/run_dev.sh`, `scripts/pi-start.sh`
and `scripts/install-pi.sh` (twice — the flag itself, and the hotspot
prompt), and is what took down the pre-commit suite for a Mac contributor
with no Homebrew bash: `test_install_pi_sourceable.py` runs `bash` as a
subprocess, and `bash` resolves to `/bin/bash` unless something else is
first on `$PATH`.

Two kinds of guard:

- A static scan (`test_no_bash4_only_case_expansion`) for the forbidden
  construct across every `.sh` file in `scripts/` and `packaging/`, in the
  spirit of `test_heat_lanes_write.py`'s AST walk: there is no bash 3.2 in
  CI (Ubuntu ships bash 5, which accepts the bash 4 syntax fine), so this is
  the check that actually runs on every pull request and catches a
  reintroduction.
- Functional tests that run the real, unmodified fix — either the whole
  script (`pi-start.sh`, which does nothing but compute an argument list and
  `exec`, so sourcing it with `exec` shadowed by a no-op function is safe),
  or the exact `case` block extracted from the file verbatim (the other
  three, whose surrounding code does things a unit test should not: activate
  a venv, spawn background servers, `apt-get install`) — under whatever bash
  the test runner has. On this suite's own machines that is bash 5, so it
  proves the *behaviour* is right (which values are truthy, case-fold works)
  without proving 3.2 compatibility on its own; the forbidden-construct scan
  above is what CI actually relies on for that. Both were additionally
  exercised by hand against a real bash-3.2.0 build (bison + a C compiler,
  not something this suite should depend on) while writing this fix, and
  every case here matched.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT_DIRS = (REPO_ROOT / "scripts", REPO_ROOT / "packaging")


def _bash_env(**overrides: str) -> dict[str, str]:
    """The subprocess environment for a `bash` invocation below.

    Inherits the *real* `$PATH` rather than hardcoding one — `subprocess.run`
    resolves the `bash` executable against whatever `PATH` is in the `env`
    dict passed to it, not the calling process's own, so a hardcoded PATH
    here would silently stop honouring a `PATH` a caller (or a developer,
    manually) put a bash 3.2 build on the front of, which is the entire
    point of these tests. `TRUSTYTRACK_HTTP_ONLY` is stripped unconditionally
    first so a value leaking in from the outer environment can never be
    mistaken for a test's own deliberate unset case.
    """
    env = dict(os.environ)
    env.pop("TRUSTYTRACK_HTTP_ONLY", None)
    env.update(overrides)
    return env


# ${name,,}, ${name^^}, ${name,}, ${name^} and the same with an array
# subscript (${arr[0],,}) -- bash 4's case-modification expansions, all
# introduced together and all absent from bash 3.2. Anchored on the
# parameter name/subscript immediately preceding the operator so this does
# not fire on an ordinary `${var:-,,}`-shaped default value elsewhere in the
# tree (there are none, but the point of a static guard is not to depend on
# that staying true by luck).
_CASE_EXPANSION = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?(,,?|\^\^?)")


def _shell_scripts() -> list[Path]:
    scripts = []
    for d in SCRIPT_DIRS:
        scripts.extend(sorted(d.glob("*.sh")))
    assert scripts, "expected to find shell scripts under scripts/ and packaging/"
    return scripts


def _non_comment_lines(text: str) -> list[tuple[int, str]]:
    """(1-based line number, line) pairs, skipping whole-line comments -- the
    fix for #891 necessarily *names* `${var,,}` in an explanatory comment
    next to every replacement, and those must not trip the guard they
    describe."""
    return [
        (i, line)
        for i, line in enumerate(text.splitlines(), start=1)
        if not line.strip().startswith("#")
    ]


def test_no_bash4_only_case_expansion():
    offenders = []
    for path in _shell_scripts():
        text = path.read_text()
        for lineno, line in _non_comment_lines(text):
            if _CASE_EXPANSION.search(line):
                offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {line}")
    assert not offenders, (
        "bash 4's ${var,,}/${var^^} case-modification expansion is not "
        'available on macOS\'s stock bash 3.2 and raises "bad substitution" '
        "there (dknowles2/trusty-track#891). Lower-case with "
        "`printf '%s' \"$var\" | tr '[:upper:]' '[:lower:]'` and branch with "
        "`case` instead:\n" + "\n".join(offenders)
    )


def test_every_script_has_a_shebang_and_is_executable():
    for path in _shell_scripts():
        assert path.stat().st_mode & 0o111, f"{path} is not executable"
        first_line = path.read_text().splitlines()[0]
        assert first_line.startswith("#!"), f"{path} has no shebang"


def test_generate_certs_stops_on_a_failing_openssl():
    """#891 also flagged `generate_certs.sh` as the one script with no
    `set -euo pipefail`, ending in an unconditional "Certificates generated
    successfully." -- so a failing `openssl req` (bad arguments, no openssl
    on $PATH, a read-only certs directory) exited 0 and `serve.sh`/
    `run_dev.sh` went on to pass `--ssl-certfile`/`--ssl-keyfile` for files
    that were never written."""
    path = REPO_ROOT / "scripts" / "generate_certs.sh"
    lines = path.read_text().splitlines()
    assert lines[0] == "#!/bin/bash"
    assert lines[1] == "set -euo pipefail", (
        "generate_certs.sh must stop at the first failing command -- see "
        "dknowles2/trusty-track#891"
    )


# ── Functional: pi-start.sh, run as the real, unmodified file ─────────────
#
# The whole script is nothing but "decide the argument list, then exec
# uvicorn with it" -- no venv, no network, no filesystem writes -- so it can
# be sourced as-is with `exec` shadowed by a shell function. Bash resolves a
# function before the `exec` builtin for an unqualified call, so the
# script's own final `exec "$UVICORN" "${ARGS[@]}"` calls the shadow instead
# of actually replacing the process, and we get the real argument list back.


def _run_pi_start(http_only: str | None) -> str:
    script = REPO_ROOT / "scripts" / "pi-start.sh"
    harness = f'exec() {{ printf "%s\\n" "$*"; }}\nsource {script}\n'
    env = _bash_env(
        **({"TRUSTYTRACK_HTTP_ONLY": http_only} if http_only is not None else {})
    )
    result = subprocess.run(
        ["bash", "-c", harness],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def test_pi_start_adds_ssl_flags_when_unset():
    args = _run_pi_start(None)
    assert "--ssl-keyfile /etc/trustytrack/key.pem" in args
    assert "--ssl-certfile /etc/trustytrack/cert.pem" in args


def test_pi_start_omits_ssl_flags_for_every_truthy_spelling():
    for value in ["1", "true", "True", "TRUE", "yes", "YES", "on", "ON"]:
        args = _run_pi_start(value)
        assert "--ssl" not in args, (
            f"TRUSTYTRACK_HTTP_ONLY={value!r} should skip TLS: {args}"
        )


def test_pi_start_adds_ssl_flags_for_every_falsy_or_junk_value():
    for value in ["", "0", "false", "no", "off", "garbage"]:
        args = _run_pi_start(value)
        assert "--ssl-keyfile /etc/trustytrack/key.pem" in args, (
            f"TRUSTYTRACK_HTTP_ONLY={value!r} should keep TLS: {args}"
        )


# ── Functional: the `case` block extracted verbatim from each script ──────
#
# serve.sh/run_dev.sh/install-pi.sh do real work around the block under
# test (activating a venv, spawning background servers, installing system
# packages), which a unit test must not do -- so, unlike pi-start.sh above,
# only the exact `case` statement is pulled out of the real file (by
# locating its start marker and the matching `esac` in the file's own
# text) and evaluated. A future edit that changes this logic without
# updating these markers fails loudly (the marker search raises) rather
# than silently testing stale text.


def _extract_block(path: Path, start_marker: str) -> str:
    text = path.read_text()
    start = text.index(start_marker)
    esac = text.index("esac", start)
    return text[start : esac + len("esac")]


def _eval_case_block(block: str, wanted_vars: list[str], **env: str) -> dict[str, str]:
    script = (
        block
        + "\n"
        + "\n".join(f'printf "{v}=%s\\n" "${{{v}:-}}"' for v in wanted_vars)
    )
    result = subprocess.run(
        ["bash", "-c", script],
        env=_bash_env(**env),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    out = {}
    for line in result.stdout.splitlines():
        key, _, value = line.partition("=")
        out[key] = value
    return out


def test_run_dev_http_only_flag():
    block = _extract_block(
        REPO_ROOT / "scripts" / "run_dev.sh", 'http_only="${TRUSTYTRACK_HTTP_ONLY:-}"'
    )
    assert _eval_case_block(block, ["HTTP_ONLY"])["HTTP_ONLY"] == "false"
    assert (
        _eval_case_block(block, ["HTTP_ONLY"], TRUSTYTRACK_HTTP_ONLY="On")["HTTP_ONLY"]
        == "true"
    )
    assert (
        _eval_case_block(block, ["HTTP_ONLY"], TRUSTYTRACK_HTTP_ONLY="nope")[
            "HTTP_ONLY"
        ]
        == "false"
    )


def test_serve_sh_http_only_branch_execs_uvicorn_with_no_certs():
    block = _extract_block(
        REPO_ROOT / "scripts" / "serve.sh", 'http_only="${TRUSTYTRACK_HTTP_ONLY:-}"'
    )
    harness = 'exec() { printf "EXEC:%s\\n" "$*"; }\n' + block
    result = subprocess.run(
        ["bash", "-c", harness],
        env=_bash_env(TRUSTYTRACK_HTTP_ONLY="1"),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "EXEC:uvicorn backend.api.main:app --host 0.0.0.0 --port 8005" in result.stdout
    )


def test_serve_sh_falls_through_when_unset():
    block = _extract_block(
        REPO_ROOT / "scripts" / "serve.sh", 'http_only="${TRUSTYTRACK_HTTP_ONLY:-}"'
    )
    harness = (
        'exec() { printf "EXEC:%s\\n" "$*"; }\n' + block + '\nprintf "FELL_THROUGH\\n"'
    )
    result = subprocess.run(
        ["bash", "-c", harness],
        env=_bash_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "EXEC:" not in result.stdout
    assert "FELL_THROUGH" in result.stdout


def test_install_pi_http_only_flag_and_scheme():
    block = _extract_block(
        REPO_ROOT / "scripts" / "install-pi.sh",
        'http_only_raw="${TRUSTYTRACK_HTTP_ONLY:-}"',
    )
    unset = _eval_case_block(block, ["HTTP_ONLY", "SCHEME"])
    assert unset == {"HTTP_ONLY": "false", "SCHEME": "https"}

    on = _eval_case_block(block, ["HTTP_ONLY", "SCHEME"], TRUSTYTRACK_HTTP_ONLY="YES")
    assert on == {"HTTP_ONLY": "true", "SCHEME": "http"}


def test_install_pi_hotspot_prompt_is_case_insensitive():
    block = _extract_block(
        REPO_ROOT / "scripts" / "install-pi.sh", 'case "$(printf \'%s\' "$HOTSPOT"'
    )
    assert "HOTSPOT" in block, block

    def proceeds(hotspot: str) -> bool:
        script = (
            f"f() {{\nHOTSPOT={hotspot!r}\n" + block + '\nprintf "PROCEEDED\\n"\n}\nf'
        )
        result = subprocess.run(
            ["bash", "-c", script],
            env=_bash_env(),
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        return "PROCEEDED" in result.stdout

    assert proceeds("y") is True
    assert proceeds("Y") is True
    for no in ["", "n", "N", "no", "garbage"]:
        assert proceeds(no) is False, no
