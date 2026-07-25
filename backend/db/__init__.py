"""Database package.

Importing :mod:`backend.db.lane_sync` here is what installs the session
listeners that keep ``heat_lanes`` in step with the ``lane_results`` blobs
(issue #5). It lives at package level so that *any* entry point which touches
the database gets it — the API, the timer's own background session, the test
suite, and anything added later — rather than depending on each one remembering
to import it.
"""

from backend.db import lane_sync  # noqa: F401  (imported for its side effects)
