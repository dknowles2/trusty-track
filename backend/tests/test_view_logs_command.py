"""The launcher's "View Logs" action opens a live, following view (#595).

`packaging/log_viewer.py` builds the argv for that; these tests exercise it
directly by loading the file rather than `import`ing it as
`packaging.log_viewer` (there is no `__init__.py`, deliberately — see the
module's own docstring) or importing `packaging.run_server` (which runs real
side effects — creating a platform data directory, generating a TLS
certificate, importing uvicorn and the whole backend — at module scope,
wrong for a unit test).
"""

import importlib.util
from pathlib import Path

import pytest

MODULE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "packaging" / "log_viewer.py"
)


def _load_log_viewer():
    spec = importlib.util.spec_from_file_location("log_viewer", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


log_viewer = _load_log_viewer()


LOG_PATH = Path("/tmp/some folder/server.log")


def test_mac_with_console_opens_console_app():
    command = log_viewer.build_view_logs_command(
        "Darwin", LOG_PATH, console_available=True
    )
    assert command == ["open", "-a", "Console", str(LOG_PATH)]


def test_mac_without_console_falls_back_to_terminal_tail_dash_capital_f():
    command = log_viewer.build_view_logs_command(
        "Darwin", LOG_PATH, console_available=False
    )
    assert command[0] == "osascript"
    assert command[1] == "-e"
    script = command[2]
    assert 'tell application "Terminal" to do script' in script
    # `-F` (capital), not `-f`: it re-opens the file by name on each poll, so
    # it survives a rename-and-recreate rotation where `-f` would not.
    assert "tail -F" in script
    # The path survived both the shell quoting and the AppleScript quoting.
    assert str(LOG_PATH) in script


def test_mac_fallback_script_is_shell_safe_for_a_path_with_a_space():
    # LOG_PATH itself already has a space; this pins that the *shell* layer
    # quotes it (single-quoted argument to `tail`), not just the AppleScript
    # layer.
    command = log_viewer.build_view_logs_command(
        "Darwin", LOG_PATH, console_available=False
    )
    script = command[2]
    assert f"tail -F '{LOG_PATH}'" in script


def test_windows_uses_get_content_wait():
    command = log_viewer.build_view_logs_command("Windows", LOG_PATH)
    assert command[0] == "powershell.exe"
    assert "-NoExit" in command
    assert "-Command" in command
    ps_command = command[-1]
    assert "Get-Content" in ps_command
    assert "-Wait" in ps_command
    assert str(LOG_PATH) in ps_command


def test_windows_command_retries_so_a_rotated_file_is_picked_back_up():
    # `Get-Content -Wait` holds its own handle open and simply stops (with a
    # non-terminating error) if the file underneath it is deleted, which is
    # what a rotation does. The `while` loop is what makes it retry, the same
    # shape as `tail -F`'s "follow by name, retry on error".
    command = log_viewer.build_view_logs_command("Windows", LOG_PATH)
    ps_command = command[-1]
    assert ps_command.strip().startswith("while (")
    assert "-ErrorAction SilentlyContinue" in ps_command


def test_windows_path_is_powershell_quoted_for_a_path_with_a_space():
    command = log_viewer.build_view_logs_command("Windows", LOG_PATH)
    ps_command = command[-1]
    assert f"'{LOG_PATH}'" in ps_command


def test_a_path_holding_a_single_quote_does_not_break_the_powershell_command():
    tricky = Path("/tmp/O'Brien's Pack/server.log")
    command = log_viewer.build_view_logs_command("Windows", tricky)
    ps_command = command[-1]
    # PowerShell single-quoted strings escape an embedded `'` by doubling it.
    assert "O''Brien''s Pack" in ps_command


def test_a_path_holding_a_double_quote_does_not_break_the_applescript_command():
    tricky = Path('/tmp/"quoted"/server.log')
    command = log_viewer.build_view_logs_command(
        "Darwin", tricky, console_available=False
    )
    script = command[2]
    # The double quote is escaped, not left to close the AppleScript literal
    # early.
    assert '\\"quoted\\"' in script


def test_unsupported_platform_raises_rather_than_guessing():
    with pytest.raises(ValueError):
        log_viewer.build_view_logs_command("Linux", LOG_PATH)


def test_console_app_available_checks_the_two_real_install_locations(monkeypatch):
    checked: list[str] = []
    original_exists = Path.exists

    def _spy(self):
        checked.append(str(self))
        return False

    monkeypatch.setattr(Path, "exists", _spy)
    try:
        assert log_viewer.console_app_available() is False
    finally:
        monkeypatch.setattr(Path, "exists", original_exists)

    assert any("Console.app" in c for c in checked)
