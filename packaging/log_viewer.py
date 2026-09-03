"""Building the command the launcher's "View Logs" action runs.

`build_view_logs_command` is deliberately pure — a platform name and a log
path (plus whether Console.app is installed, which the caller decides) go
in, and an argv list comes out. Nothing here touches the filesystem or
spawns a process, so it is testable without a Mac, a Windows box, or a real
log file. `run_server.py` is the only caller, and it is the one that
`Popen`s the result.

Kept as its own module, sibling to `run_server.py`, rather than a function
inside it: importing `run_server` runs its module-level side effects
(creating the platform data directory, generating a TLS certificate,
importing uvicorn and the whole backend) the moment it is imported, which is
wrong for a unit test and unnecessary for exercising this one rule.
"""

from __future__ import annotations

from pathlib import Path

# `tail -F` (capital) reopens the file by *name* on each poll rather than
# holding a single file descriptor open, so it keeps following through a
# rename-and-recreate rotation; plain `-f` would be left watching the old,
# now-renamed file forever and would never see what gets written to the new
# one at the same path. Trusty Track's own `logging.basicConfig` opens a
# plain `FileHandler` and never rotates `server.log` today — but an
# operator's own log-rotation tool (or a future switch to
# `RotatingFileHandler`) does exactly that rename-and-recreate, so `-F` is
# the one that survives either without anybody having to remember why.
_TAIL_FLAG = "-F"

# PowerShell has no built-in equivalent of `-F`: `Get-Content -Wait` holds
# its own handle open and simply stops (with a non-terminating error) if the
# file is deleted out from under it, which is what a rotation does. Wrapping
# it in a `while` loop that retries after a short pause is the closest
# analogue to `-F`'s "follow by name, retry on error" behaviour — the same
# shape, in a language that does not have the flag.
_POWERSHELL_TAIL_LINES = 200


def build_view_logs_command(
    system: str, log_path: Path, *, console_available: bool = True
) -> list[str]:
    """Return the argv that opens `log_path` as a live, following view.

    `system` is `platform.system()`'s vocabulary (`"Darwin"`, `"Windows"`).
    `console_available` says whether macOS's Console.app is installed; that
    is a filesystem check, kept out of this function so the function itself
    stays pure — see `console_app_available` below.
    """
    if system == "Darwin":
        if console_available:
            # Console.app follows a file live on its own — it is built to
            # watch logs that rotate out from under it — and is what a
            # non-technical person expects "View Logs" to open.
            return ["open", "-a", "Console", str(log_path)]
        # No Console.app (a stripped-down install, some CI images): fall
        # back to a Terminal window running `tail -F`. `open` has no way to
        # hand Terminal a command to run, so this goes through AppleScript.
        shell_command = f"tail {_TAIL_FLAG} {_shell_quote(str(log_path))}"
        script = (
            'tell application "Terminal" to do script "'
            f'{_applescript_quote(shell_command)}"'
        )
        return ["osascript", "-e", script]
    if system == "Windows":
        command = (
            "while ($true) { "
            f"Get-Content -Path {_powershell_quote(str(log_path))} "
            f"-Wait -Tail {_POWERSHELL_TAIL_LINES} -ErrorAction SilentlyContinue; "
            "Start-Sleep -Seconds 1 }"
        )
        return ["powershell.exe", "-NoExit", "-Command", command]
    raise ValueError(f"unsupported platform for View Logs: {system!r}")


def console_app_available() -> bool:
    """Whether macOS's Console.app is present on this machine.

    Checked rather than assumed: Console.app ships with macOS but can be
    removed from a stripped-down install or a CI image, and `open -a
    Console` on a machine without it pops an unhelpful "can't find
    application" dialog instead of falling back to Terminal.
    """
    return any(
        Path(candidate).exists()
        for candidate in (
            "/System/Applications/Utilities/Console.app",
            "/Applications/Utilities/Console.app",
        )
    )


def _shell_quote(value: str) -> str:
    """Quote a string for a POSIX shell command (single-quote, escape `'`)."""
    return "'" + value.replace("'", "'\\''") + "'"


def _applescript_quote(value: str) -> str:
    """Escape a string for embedding in an AppleScript double-quoted literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _powershell_quote(value: str) -> str:
    """Quote a string for embedding in a PowerShell `-Command` argument."""
    return "'" + value.replace("'", "''") + "'"
