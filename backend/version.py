import subprocess


def _get_git_hash():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()
    except Exception:
        return "unknown"

__version__ = f"0.0.0-dev-{_get_git_hash()}"
