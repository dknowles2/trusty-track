"""The public demo instance, and what it is not allowed to do.

Trusty Track's threat model is a Raspberry Pi on venue wifi: "everyone who can
reach the server" is everyone in the building, and the control is a PIN the
operator sets if they want one (#15). A public demo leaves that model entirely
— the instance is writable by strangers, and two of them are one click from
ending it.

``createInitialConfig`` sets the operator PIN, and an install with no PIN
treats every caller as ``OPERATOR``. So the first visitor to open System
Settings owns the demo until it is reset.

``POST /upload/`` writes a permanent file from an unauthenticated request. On
a public URL that is an anonymous image host, and it is the route by which a
real photograph of a real child could arrive on a machine that exists to avoid
holding one.

Off by default
--------------
Absent means "an ordinary install", which is every install that exists. Nothing
here changes behaviour for an operator running the Docker image on their own
hardware, and no test sees it unless it asks. Same shape as
:mod:`backend.demo_seed`: opt-in, read at call time so that it can be set for
one test rather than one process.

One flag, one seam
------------------
The refusals live in :mod:`backend.api.demo_policy` (mutations) and in the four
REST routes that the GraphQL policy cannot see. Scattering ``if enabled()``
through resolvers is the failure #48 keeps recording — a rule that depends on
every caller remembering reaches only some of them.
"""

import os

#: The environment variable. Any truthy value turns the demo on.
DEMO_VARIABLE = "TRUSTYTRACK_DEMO_MODE"

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def enabled() -> bool:
    """Whether this process is serving the public demo.

    Read from the environment on every call rather than captured at import.
    That is what lets a test set it with ``monkeypatch.setenv`` and lets the
    value be false again afterwards; a module-level constant would freeze
    whatever the first import happened to see.
    """
    return os.getenv(DEMO_VARIABLE, "").strip().lower() in _TRUTHY
