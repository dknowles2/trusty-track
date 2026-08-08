"""Who is allowed to run which mutation (#15).

The deployment is a Raspberry Pi on venue wifi during an event, so "everyone who
can reach the server" is everyone in the building. Today that includes
``deleteRace``. The threat is not an attacker; it is a bored child with a phone.

Three roles, derived from who is physically in the room rather than from an
abstract permission model:

``viewer``
    The audience displays on the wall. Reads and subscribes, and runs no
    mutation at all. The default, with no credential — a display should be
    pointed at a URL without ceremony.
``checkin``
    The registration desk, where cars are handed in. Racers, photos and
    check-in; nothing about scheduling or results.
``operator``
    The one person running the race. Everything.

One enforcement seam, not two
-----------------------------
The design sketch on #15 proposed two layers: ``allowed_operation_types`` for
``viewer``, and a per-operation table for the ``checkin``/``operator`` split.
Only the second is here, because testing the first found it does not fit this
version of Strawberry and does not buy anything:

* ``AsyncBaseHTTPView.execute_single`` *recomputes* ``allowed_operation_types``
  from the HTTP method, so overriding ``execute_operation`` — the seam the
  sketch names — constrains only the batch and streaming paths, not the ordinary
  one. Making it work means reimplementing the body of ``execute_single``.
* It is redundant. ``viewer`` holds an empty set here, so every mutation is
  refused anyway, and :func:`~backend.tests.test_auth_policy` fails the build if
  a new one is not classified.
* It leaves the gap the sketch flagged: subscriptions arrive over ``graphql-ws``,
  which permits mutations on the same socket. ``resolve`` fires there too —
  measured, not assumed — so one seam covers both transports.

``resolve`` and not ``on_execute``: raising from ``on_execute`` is silently
swallowed and the mutation completes, which is a guard that passes its own test
while permitting everything. The tests here assert a mutation is *refused* —
that the row is absent — rather than that the check ran.

Off until a PIN is set
----------------------
An install with no operator PIN treats every caller as ``operator``, which is
exactly today's behaviour. That is deliberate: it keeps upgrades from breaking
an event, and it honours why this was deferred — nobody wants a login prompt on
race morning. Enforcement begins when the operator sets a PIN, and
``initialConfig`` reports whether one is set so the UI can say so.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from enum import Enum
from typing import Any

from strawberry.extensions import SchemaExtension

#: Header the client sends its PIN in. Same-origin, so no cookie and no CORS
#: exposure; on a LAN over plain HTTP a bearer token would be no less readable
#: than the PIN itself, and would add an expiry and a signing secret to get
#: wrong.
PIN_HEADER = "x-trustytrack-pin"

_PBKDF2_ROUNDS = 200_000


class Role(str, Enum):
    """A caller's role. ``str`` so it crosses into GraphQL unchanged."""

    VIEWER = "VIEWER"
    CHECKIN = "CHECKIN"
    OPERATOR = "OPERATOR"


#: What the registration desk needs. Everything else is the operator's.
#:
#: ``deleteRacer`` and ``bulkDeleteRacers`` are here despite being destructive:
#: a child registered twice is a desk problem, and sending them to find the
#: operator mid-queue is worse than the risk. Scoped to racers either way —
#: nothing here can touch a schedule, a result or a race.
CHECKIN_MUTATIONS = frozenset(
    {
        "createRacer",
        "updateRacer",
        "deleteRacer",
        "checkInRacer",
        "importRacers",
        "uploadImage",
        "bulkCheckIn",
        "bulkAutoNumber",
        "bulkClearNumbers",
        "bulkMoveToDen",
        "bulkAssignPhotos",
        "bulkDeleteRacers",
    }
)

#: Everything else. Enumerated rather than "whatever is left" so that a new
#: mutation is *unclassified* rather than silently granted to the operator —
#: `test_auth_policy.py` compares this against the schema in both directions.
OPERATOR_ONLY_MUTATIONS = frozenset(
    {
        # Race, den and track
        "createRace",
        "updateRace",
        "deleteRace",
        "createDen",
        "updateDen",
        "deleteDen",
        "createTrack",
        "updateTrack",
        "deleteTrack",
        # Which lanes are out of service (#171). Operator: it changes what
        # every future schedule looks like.
        "setLaneOutages",
        # Scheduling
        "createRound",
        "createRoundWizard",
        "regenerateRound",
        "deleteRound",
        "deleteHeat",
        "reorderHeats",
        # Results and advancement
        "advanceRound",
        "updateHeatResult",
        # Awards (#170). Operator rather than check-in: an award is an outcome,
        # and deciding Best Paint from the registration tablet is not a thing
        # the desk should be able to do.
        "createAward",
        "updateAward",
        "deleteAward",
        "reorderAwards",
        # Timer
        "prepareHeat",
        "abortHeat",
        "forceResults",
        "releaseStartGate",
        "resetTimer",
        "reconnectTimer",
        "fakeTimerStart",
        "fakeTimerFinish",
        # Free race
        "startFreeRaceHeat",
        "recordFreeRaceResult",
        "deleteFreeRaceHeat",
        # System
        "createInitialConfig",
        "updateInitialConfig",
        "populateRace",
    }
)

POLICY: dict[Role, frozenset[str]] = {
    Role.VIEWER: frozenset(),
    Role.CHECKIN: CHECKIN_MUTATIONS,
    Role.OPERATOR: CHECKIN_MUTATIONS | OPERATOR_ONLY_MUTATIONS,
}


class PermissionDeniedError(Exception):
    """A caller ran a mutation their role does not carry."""


class RolePolicyExtension(SchemaExtension):
    """Refuse a mutation the caller's role does not allow.

    ``resolve`` fires for every field, so the guard is scoped to fields whose
    parent is ``Mutation`` — a query or subscription costs one string compare.
    """

    def resolve(
        self, _next: Any, root: Any, info: Any, *args: Any, **kwargs: Any
    ) -> Any:
        if info.parent_type.name == "Mutation":
            role = resolve_role(info.context)
            if info.field_name not in POLICY[role]:
                raise PermissionDeniedError(
                    f"{role.value} is not allowed to run {info.field_name}"
                )
        return _next(root, info, *args, **kwargs)


# --------------------------------------------------------------------------- #
# PINs                                                                         #
# --------------------------------------------------------------------------- #


def hash_pin(pin: str) -> str:
    """A PIN as ``salt$hash``, ready to store.

    PBKDF2 rather than a bare digest because a PIN is four digits — the whole
    keyspace is 10,000, so anything fast is a lookup table. This does not make a
    stolen database safe, it makes it slow; the real control is that the
    database lives on the operator's own machine.
    """
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), _PBKDF2_ROUNDS)
    return f"{salt}${digest.hex()}"


def verify_pin(pin: str, stored: str | None) -> bool:
    """Whether ``pin`` matches a stored ``salt$hash``. False if nothing is set."""
    if not stored or "$" not in stored:
        return False
    salt, expected = stored.split("$", 1)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), _PBKDF2_ROUNDS)
    return hmac.compare_digest(digest.hex(), expected)


def role_for(
    pin: str | None, *, operator_pin_hash: str | None, checkin_pin_hash: str | None
) -> Role:
    """The role a caller gets.

    No operator PIN configured means no enforcement: everyone is ``operator``,
    which is what every install does today. A wrong PIN is ``viewer`` rather
    than an error — a display that sends nothing and a phone that guesses wrong
    are the same thing, and answering "wrong PIN" to an unauthenticated caller
    tells them a PIN exists.
    """
    if not operator_pin_hash:
        return Role.OPERATOR
    if pin:
        if verify_pin(pin, operator_pin_hash):
            return Role.OPERATOR
        if verify_pin(pin, checkin_pin_hash):
            return Role.CHECKIN
    return Role.VIEWER


def resolve_role(context: dict) -> Role:
    """The caller's role, worked out once per operation and then remembered.

    Deferred rather than resolved when the context is built, because working it
    out costs a query for the configured PINs and only a *mutation* ever asks.
    Queries and subscriptions are the whole of what an audience display does, so
    making them pay for it would be a constant cost on the one path that has
    none — and `test_query_counts.py` caught exactly that.
    """
    role = context.get("role")
    if role is None:
        resolver = context.get("role_resolver")
        role = resolver() if resolver else Role.OPERATOR
        context["role"] = role
    return role
