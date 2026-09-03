"""Mutations a locked race refuses (#585).

An event concludes and the machine stays at the venue, or comes home to sit
on a shelf until next year — a shared laptop a curious sibling can reach, or
an operator's own muscle memory reopening the wrong race weeks later. Nothing
here is about a person with something to hide; it is a guard against an
accidental edit to a record that is otherwise done.

A denylist, in the same spirit as ``api/demo_policy.py`` and for the same
reason: this list is enumerated rather than inferred so it can be read next
to the thing it protects, and ``test_race_lock.py`` checks it against the
schema in one direction only, exactly as the demo's does — a mutation this
module has not heard of yet is ordinary behaviour on a locked race, and
failing closed here would mean every mutation added after this file silently
stops working the moment a race is locked, with nothing to say so.

What stays reachable on a locked race
--------------------------------------
Everything not named below, and in particular:

* every read — a query or a subscription costs this module nothing, since
  ``resolve`` only looks at fields whose parent is ``Mutation``;
* ``deleteRace`` — a locked race remains deletable (the issue's own
  requirement); the frontend's own safeguard is typing the race's name into
  the confirmation, not a second server-side gate — the operator PIN is
  already the credential that matters here;
* ``updateRace``, but only when the payload touches nothing but
  ``isLocked`` — the operator's own way back out. See
  :func:`is_lock_only_update`;
* the display mutations (``assignDisplay``, ``advanceDisplay``,
  ``identifyDisplay``, ``renameDisplay``, ``forgetDisplay``) — they are about
  which screen shows what, not about the race's own record, the same
  reasoning that puts them outside ``CHECKIN_MUTATIONS``/needing anything
  beyond an ``OPERATOR`` role in the first place;
* ``castVote`` — a locked race has presumably finished being judged too, but
  voting is gated by its own ``Race.votingOpen`` switch (#305); teaching this
  module a second opinion about it would be a rule with two homes;
* track-scoped mutations (``createTrack``/``updateTrack``/``deleteTrack``,
  ``setLaneOutages``, the historical track record mutations, and the
  low-level timer commands — ``reconnectTimer``, ``abortHeat``,
  ``forceResults``, ``startTimerTest``, ``releaseStartGate``,
  ``resetTimer``). A track is shared, global state (see ``CLAUDE.md``'s
  "Heat scheduling" section) — a track can be running a second, unlocked
  race at the same venue, and disarming its timer or refusing to reconnect
  it over a *different* race's lock would break that race for no reason;
* ``createInitialConfig``/``updateInitialConfig``/``uploadImage``/
  ``createPracticeRace``/``createRace`` — none of these names an existing
  race in its arguments, so there is nothing here to resolve a lock against.

Where this sits in the extension list
--------------------------------------
Registration order reads backwards — a *later* extension wraps an earlier
one, so execution runs from the end of the list towards the front. The list
is::

    [RaceLockExtension, RolePolicyExtension, DemoPolicyExtension, AuditExtension]

Two things follow, and both are the point:

* listed **before** ``AuditExtension`` (anywhere left of it), a lock refusal
  is raised inside that hook, so the activity log records it exactly like
  any other refusal (#219);
* listed **before** ``RolePolicyExtension`` — to its *left*, which is the
  more deeply nested position — so the role policy's own check runs first.
  A ``VIEWER`` attempting ``updateHeatResult`` on a locked race should be
  told their role cannot do that, not that the race happens to be locked;
  the lock check only runs once the role policy has already let the
  mutation through.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import fields as dataclass_fields
from dataclasses import is_dataclass
from typing import Any

from sqlalchemy.orm import Session
from strawberry.extensions import SchemaExtension

from backend.api.auth import PermissionDeniedError
from backend.db import models

#: What the operator sees, and what the audit log's `details` for a refusal
#: carries — read by the frontend surfaces this mirrors, too.
LOCK_MESSAGE = "This race is locked. Unlock it from Edit race to make changes."


def _snake(name: str) -> str:
    """`camelCase` to `snake_case` — cheaper than importing a library for
    the handful of field names this ever sees."""
    out = []
    for ch in name:
        if ch.isupper():
            out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def _fields_of(obj: Any) -> dict[str, Any]:
    """A nested input object's fields as a plain `{snake_case_name: value}`
    mapping, whichever shape strawberry handed this resolver.

    An inline literal argument arrives as the input's own dataclass
    instance; one supplied through GraphQL `variables` — every test here,
    and every real client, since `urql`'s `gql` documents always use
    variables — arrives as a plain `dict` with camelCase keys instead.
    `domain.audit._fields_of` draws the same distinction, for the same
    reason: this module cannot assume either shape.
    """
    if is_dataclass(obj) and not isinstance(obj, type):
        return {field.name: getattr(obj, field.name) for field in dataclass_fields(obj)}
    if isinstance(obj, dict):
        return {_snake(key): value for key, value in obj.items()}
    return {}


def _input_field(obj: Any, name: str) -> Any:
    """One field off a nested input object, by its `snake_case` name."""
    return _fields_of(obj).get(name)


def _camel(name: str) -> str:
    """`snake_case` to `camelCase` — the inverse of `_snake`."""
    head, *rest = name.split("_")
    return head + "".join(word.title() for word in rest)


def _arg(kwargs: dict[str, Any], name: str) -> Any:
    """A top-level mutation argument, by its `snake_case` name.

    A resolver's own `**kwargs` is keyed by the GraphQL argument's wire name
    (camelCase) for a multi-word argument — `heatId`, not `heat_id` — the
    same thing `_race_id_from` in `api/auth.py` works around by checking
    both spellings. A single-word argument (`id`, `race`, `racer`) is
    unaffected either way, which is why most call sites here never noticed.
    """
    if name in kwargs:
        return kwargs[name]
    return kwargs.get(_camel(name))


def _int_arg(kwargs: dict[str, Any], name: str) -> int | None:
    value = _arg(kwargs, name)
    return value if isinstance(value, int) else None


#: Every resolver below returns whether *the race the mutation concerns* is
#: locked, `False` when there is nothing to resolve (an absent or unknown
#: id) — not the race id itself. Costing one query, a `JOIN` from the named
#: row to `Race.is_locked` rather than two round trips (fetch the row, then
#: fetch its race), is not tidiness: `test_query_counts.py::
#: test_bulk_move_to_den_is_a_single_update` measured the two-query version
#: directly, and a resolver that fetches a whole `Racer`/`Heat`/`Round`/
#: `RacingGroup`/`Award` row just to read its `race_id` is doing the
#: coarser-grained thing that guard exists to catch (#11) — the same lesson
#: `loaders.scheduled_racer_ids` already learned once.


def _direct_locked(db: Session, kwargs: dict[str, Any]) -> bool:
    """`raceId` named plainly in the mutation's own arguments."""
    race_id = _int_arg(kwargs, "race_id")
    return race_id is not None and _race_is_locked(db, race_id)


def _locked_via(model: Any, id_arg: str) -> Callable[[Session, dict[str, Any]], bool]:
    """A resolver for "this id names a row with its own `race_id` column" —
    every shape here but the bulk/nested ones below, which have no single
    row to join from until a list or an input object is unpacked first."""

    def resolver(db: Session, kwargs: dict[str, Any]) -> bool:
        row_id = _int_arg(kwargs, id_arg)
        if row_id is None:
            return False
        locked = (
            db.query(models.Race.is_locked)
            .join(model, model.race_id == models.Race.id)
            .filter(model.id == row_id)
            .scalar()
        )
        return bool(locked)

    return resolver


_heat_locked = _locked_via(models.Heat, "heat_id")
_round_locked = _locked_via(models.Round, "round_id")
_racer_locked = _locked_via(models.Racer, "id")
_racing_group_locked = _locked_via(models.RacingGroup, "id")
_award_locked = _locked_via(models.Award, "id")


def _racer_ids_locked(db: Session, kwargs: dict[str, Any]) -> bool:
    """A bulk racer mutation — resolved from the first id in the list.

    Every racer named belongs to the same race in practice (the roster
    screen that sends this list is itself scoped to one race), so the first
    is enough; this is the same shallow-rather-than-exhaustive trade
    `_race_id_from` in `api/auth.py` makes for the audit log.
    """
    racer_ids = _arg(kwargs, "racer_ids")
    if not racer_ids:
        return False
    locked = (
        db.query(models.Race.is_locked)
        .join(models.Racer, models.Racer.race_id == models.Race.id)
        .filter(models.Racer.id == racer_ids[0])
        .scalar()
    )
    return bool(locked)


def _racer_input_locked(db: Session, kwargs: dict[str, Any]) -> bool:
    """`createRacer` — the new racer's own `race_id`, off its input object."""
    race_id = _input_field(_arg(kwargs, "racer"), "race_id")
    return isinstance(race_id, int) and _race_is_locked(db, race_id)


def _photo_assignments_locked(db: Session, kwargs: dict[str, Any]) -> bool:
    """`bulkAssignPhotos` — resolved off the first assignment's `racerId`."""
    assignments = _arg(kwargs, "assignments")
    if not assignments:
        return False
    racer_id = _input_field(assignments[0], "racer_id")
    if not isinstance(racer_id, int):
        return False
    locked = (
        db.query(models.Race.is_locked)
        .join(models.Racer, models.Racer.race_id == models.Race.id)
        .filter(models.Racer.id == racer_id)
        .scalar()
    )
    return bool(locked)


def _heat_updates_locked(db: Session, kwargs: dict[str, Any]) -> bool:
    """`reorderHeats` — resolved off the first update's `heatId`."""
    heat_updates = _arg(kwargs, "heat_updates")
    if not heat_updates:
        return False
    heat_id = _input_field(heat_updates[0], "heat_id")
    if not isinstance(heat_id, int):
        return False
    locked = (
        db.query(models.Race.is_locked)
        .join(models.Heat, models.Heat.race_id == models.Race.id)
        .filter(models.Heat.id == heat_id)
        .scalar()
    )
    return bool(locked)


#: One resolver per argument shape, not one per mutation — several mutations
#: share a shape (`updateRacer`/`deleteRacer`/`checkInRacer` all just name a
#: racer `id`) and reuse the same function. `updateRace` and `deleteRace` are
#: deliberately absent: both are handled directly in
#: :class:`RaceLockExtension.resolve`, since neither is an ordinary "look up
#: this id and refuse" case.
LOCKED_MUTATION_RESOLVERS: dict[str, Callable[[Session, dict[str, Any]], bool]] = {
    # Named `raceId` directly.
    "createRacingGroup": _direct_locked,
    "createAward": _direct_locked,
    "reorderAwards": _direct_locked,
    "createRunOffHeat": _direct_locked,
    "advanceRound": _direct_locked,
    "createRoundWizard": _direct_locked,
    "createRound": _direct_locked,
    "importRacers": _direct_locked,
    "populateRace": _direct_locked,
    "applyMasterRunningOrder": _direct_locked,
    "startFreeRaceHeat": _direct_locked,
    # Named `heatId`.
    "deleteHeat": _heat_locked,
    "deleteFreeRaceHeat": _heat_locked,
    "deleteRunOffHeat": _heat_locked,
    "updateHeatResult": _heat_locked,
    "recordFreeRaceResult": _heat_locked,
    "prepareHeat": _heat_locked,
    "fakeTimerStart": _heat_locked,
    "fakeTimerFinish": _heat_locked,
    # Named `roundId`.
    "regenerateRound": _round_locked,
    "deleteRound": _round_locked,
    # Named `id`, meaning a racer.
    "updateRacer": _racer_locked,
    "deleteRacer": _racer_locked,
    "checkInRacer": _racer_locked,
    # Named `id`, meaning a racing group.
    "updateRacingGroup": _racing_group_locked,
    "deleteRacingGroup": _racing_group_locked,
    # Named `id`, meaning an award.
    "updateAward": _award_locked,
    "deleteAward": _award_locked,
    # A `racerIds` list.
    "bulkAutoNumber": _racer_ids_locked,
    "bulkClearNumbers": _racer_ids_locked,
    "bulkCheckIn": _racer_ids_locked,
    "bulkSetExcludedFromStandings": _racer_ids_locked,
    "bulkMoveToRacingGroup": _racer_ids_locked,
    "bulkDeleteRacers": _racer_ids_locked,
    # A nested input object.
    "createRacer": _racer_input_locked,
    "bulkAssignPhotos": _photo_assignments_locked,
    "reorderHeats": _heat_updates_locked,
}


#: Each explicit clear flag, and which stored column(s) it would blank —
#: named here rather than imported from `api.schema` (which imports this
#: module back) or `domain.terminology` (`_TERMINOLOGY_FIELDS`'s original
#: home), small and stable enough that a second copy beats the cycle.
_CLEAR_FLAG_TARGETS: dict[str, tuple[str, ...]] = {
    "clear_weight_limit": ("weight_limit_oz",),
    "clear_terminology": (
        "racing_group_singular",
        "racing_group_plural",
        "organization_singular",
        "organization_plural",
        "vehicle_singular",
        "vehicle_plural",
        "vehicle_artwork_key",
    ),
    "clear_name_display": ("name_display",),
}


def is_lock_only_update(race: models.Race, race_update: Any) -> bool:
    """Whether applying `race_update` to `race` would change anything besides
    `isLocked`.

    Compared against the race's own *current* stored values, not against
    each field's schema default. That is the deliberate choice: the
    operator's own way to unlock a race is `RaceForm`, and the screen that
    submits it resends every setting at its present value on every save —
    `RaceDetails.handleUpdateRace` builds the whole payload, not a diff, the
    same way every other `updateRace` caller in this codebase does. A
    comparison against "is this field absent" would refuse the very save the
    lock's own unlock checkbox produces, since `name`, `trackId`,
    `scoringStrategy` and the rest all arrive non-null and unchanged
    alongside `isLocked: false`. A comparison against "does this field
    actually move" does not — an unrelated field resent at its own value is
    not a change, and a field genuinely being edited alongside the unlock
    still is.

    A str `Enum` column (`scoring_strategy`, `tiebreaker`,
    `car_numbering_strategy`) compares equal to its own value as a plain
    string — `ScoringStrategy.TIMED == "TIMED"` — so no extraction is needed
    before comparing it against the payload's string.
    """
    for name, value in _fields_of(race_update).items():
        if name == "is_locked":
            continue
        if name in _CLEAR_FLAG_TARGETS:
            if value and any(
                getattr(race, column) is not None
                for column in _CLEAR_FLAG_TARGETS[name]
            ):
                return False
            continue
        if value is None:
            continue
        if getattr(race, name, None) != value:
            return False
    return True


def _race_is_locked(db: Session, race_id: int) -> bool:
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    return bool(race and race.is_locked)


class RaceLockExtension(SchemaExtension):
    """Refuse a mutation against a race whose `isLocked` flag is set.

    `resolve` and not `on_execute`, for the reason every neighbouring
    extension in this package gives: raising from `on_execute` is silently
    swallowed and the mutation completes anyway, so a guard tested that way
    can pass while permitting everything. `test_race_lock.py` asserts a
    refusal by the row's absence, never by whether the check merely ran.
    """

    def resolve(
        self, _next: Any, root: Any, info: Any, *args: Any, **kwargs: Any
    ) -> Any:
        if info.parent_type.name != "Mutation":
            return _next(root, info, *args, **kwargs)

        field_name = info.field_name
        db = info.context["db"]

        if field_name == "updateRace":
            race_id = _int_arg(kwargs, "id")
            race_update = _arg(kwargs, "race")
            race = (
                db.query(models.Race).filter(models.Race.id == race_id).first()
                if race_id is not None
                else None
            )
            if (
                race is not None
                and race.is_locked
                and not is_lock_only_update(race, race_update)
            ):
                raise PermissionDeniedError(LOCK_MESSAGE)
        else:
            resolver = LOCKED_MUTATION_RESOLVERS.get(field_name)
            if resolver is not None and resolver(db, kwargs):
                raise PermissionDeniedError(LOCK_MESSAGE)

        return _next(root, info, *args, **kwargs)
