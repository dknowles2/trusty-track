"""
Trusty Track Desktop Launcher

Starts the bundled FastAPI server, waits for it to be ready,
then opens the user's default browser.
"""

import os
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

APP_URL = "http://localhost:8000"
HEALTH_URL = f"{APP_URL}/health"
STARTUP_TIMEOUT = 30  # seconds


def get_data_dir() -> Path:
    """Return the platform-appropriate data directory."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "TrustyTrack"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA", str(Path.home()))
        base = Path(appdata) / "TrustyTrack"
    else:
        base = Path.home() / ".trustytrack"
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_server_executable() -> Path:
    """Return the path to the bundled server executable.

    The launcher is always a plain Python script, so the server executable
    lives in the same directory as this file (Contents/MacOS/ on macOS,
    the install dir on Windows).
    """
    launcher_dir = Path(__file__).resolve().parent
    if platform.system() == "Windows":
        return launcher_dir / "trustytrack-server.exe"
    return launcher_dir / "trustytrack-server"


def wait_for_server(proc: subprocess.Popen, timeout: int = STARTUP_TIMEOUT) -> bool:
    """Poll /health until the server responds, the process dies, or it times out."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        # If the process has already exited, no point waiting further.
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.5)
    return False


def show_error(message: str) -> None:
    """Display an error dialog and also print to stderr."""
    print(f"ERROR: {message}", file=sys.stderr)
    system = platform.system()
    if system == "Darwin":
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display dialog "{message}" with title "Trusty Track" '
                f'buttons {{"OK"}} default button "OK" with icon stop',
            ],
            check=False,
        )
    elif system == "Windows":
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "Trusty Track", 0x10)  # type: ignore[attr-defined]


def main() -> None:
    data_dir = get_data_dir()
    log_path = data_dir / "server.log"
    server_exe = get_server_executable()

    print(f"Data directory : {data_dir}")
    print(f"Server log     : {log_path}")
    print(f"Server binary  : {server_exe}")

    if not server_exe.exists():
        show_error(
            f"Server executable not found:\n{server_exe}\n\n"
            "The application bundle may be incomplete. Please re-download."
        )
        sys.exit(1)

    env = os.environ.copy()
    env["TRUSTYTRACK_DATA_DIR"] = str(data_dir)

    with open(log_path, "w") as log_file:
        proc = subprocess.Popen(
            [str(server_exe)],
            env=env,
            stdout=log_file,
            stderr=log_file,
        )

    try:
        print("Waiting for server to start...")
        if not wait_for_server(proc):
            # Read the tail of the log to include in the error message
            try:
                log_tail = log_path.read_text()[-1000:]
            except OSError:
                log_tail = "(log unreadable)"

            exit_code = proc.poll()
            if exit_code is not None:
                detail = f"Server exited with code {exit_code}."
            else:
                detail = "Server did not respond within 30 seconds."

            print(f"\nServer output:\n{log_tail}", file=sys.stderr)
            show_error(
                f"Trusty Track could not start. {detail}\n\nLog file: {log_path}"
            )
            proc.terminate()
            sys.exit(1)

        print(f"Server ready. Opening {APP_URL}")
        webbrowser.open(APP_URL)

        # Keep the launcher alive — it owns the server process
        proc.wait()

    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
