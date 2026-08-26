"""Where one run of the suite writes.

Its own module, imported by `conftest.py` before anything else, because the
name has to be decided at import time — `database.py` reads
``TRUSTYTRACK_DATA_DIR`` when it is imported and makes the uploads directory
as a side effect. It holds no application import for the same reason.

The name has to separate three things, and it grew a part for each as they
went wrong:

**The machine's temporary directory** rather than a literal ``/tmp``.
``gettempdir()`` honours ``TMPDIR``, and on macOS that is a per-user
directory.

**The checkout**, because several worktrees of this repository are a normal
way to work and each has its own pytest, its own pre-commit hook, and the
same ``TMPDIR``. The first thing `conftest.py` does with this directory is
delete it, so two worktrees committing at the same time had one run wiping
the other's database and uploads mid-test. Rare, and quiet when it happened:
most tests hold their database in memory and never notice, so what surfaced
was the occasional inexplicable failure in the handful that do — the backup
service zips this directory, and `test_init_db` opens the file database in
it.

**The xdist worker**, because the suite runs `-n auto` and its workers are
processes that import this the same way.

What is deliberately *not* in the name is anything unique per run — a pid, a
timestamp. A fixed name is what lets the directory be wiped at the start of a
run rather than the end: a run that crashes or is killed still leaves a
virgin directory for the next one, which teardown cannot promise, and the
wreckage of a failed run stays put to be looked at.
"""

from __future__ import annotations

import hashlib
import os
import tempfile

__all__ = ["data_dir_for"]


def data_dir_for(checkout: str, worker: str | None) -> str:
    """The data directory for a checkout, and one xdist worker within it.

    ``worker`` is ``PYTEST_XDIST_WORKER`` — ``None`` or empty for a run
    without xdist, which is named "main" rather than left off so that every
    directory in ``TMPDIR`` reads the same way.
    """
    token = hashlib.sha256(os.path.abspath(checkout).encode()).hexdigest()[:8]
    return os.path.join(
        tempfile.gettempdir(), f"trustytrack_test_{token}_{worker or 'main'}"
    )
