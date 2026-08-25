"""Mutations the public demo refuses.

A denylist, not an allowlist, and that asymmetry with :mod:`backend.api.auth`
is deliberate. The role policy classifies every mutation and denies anything
absent from the table, because an unclassified mutation should fail closed —
you would otherwise find out at 9am on race day. Here the opposite is right: a
new mutation is ordinary demo behaviour, and failing closed would mean every
feature added after this file silently stops working on the demo with nothing
to say so.

So :func:`test_every_refused_mutation_exists` compares in one direction only.
See the note there; it reads as an oversight beside its neighbour otherwise.

Where this sits in the extension list
-------------------------------------
Registration order reads backwards — a *later* extension wraps an earlier one,
so execution runs from the end of the list towards the front. The list is::

    [RolePolicyExtension, DemoPolicyExtension, AuditExtension]

which runs ``AuditExtension`` outermost, then this, then the role policy. Two
things follow, and both are the point:

* listed **before** ``AuditExtension``, a demo refusal is raised inside its
  hook, so the activity log records it — the same reasoning that put the audit
  extension after the role policy (#219);
* listed **after** ``RolePolicyExtension``, this runs first, so a visitor is
  told the demo does not offer the mutation rather than being told their role
  is wrong. On a demo with no PIN set every caller is ``OPERATOR``, so the role
  policy would have allowed it and the message would have been misleading.
"""

from typing import Any

from strawberry.extensions import SchemaExtension

from backend import demo_mode
from backend.api.auth import PermissionDeniedError

#: Mutations the demo does not offer.
#:
#: Deliberately short. Deleting a race, a round or a heat stays *allowed* —
#: destroying things is part of what a demo is for, and the reset undoes it.
#: What is here is the set a visitor could use to end the demo for everybody
#: else, or to put something on the disk that should not be there.
REFUSED_MUTATIONS = frozenset(
    {
        # Sets the operator and check-in PINs. With no PIN set every caller is
        # OPERATOR, so any visitor can set one and lock out everyone after
        # them — the demo's single most reachable way to break. It also
        # reconfigures tracks, including the timer type, which is the way back
        # in to the serial probing that `initialize_timer_managers` skips.
        "createInitialConfig",
        "updateInitialConfig",
        # Writes a caller-supplied image to the disk. The demo exists partly to
        # avoid holding a photograph of somebody's child; this is the route by
        # which one would arrive. Its REST twin `POST /upload/` is refused in
        # `api/main.py`, which the GraphQL policy cannot see.
        "uploadImage",
        # Unbounded row generators behind no credential. The demo is seeded
        # already, so a visitor has no reason to reach for either.
        "populateRace",
        "createPracticeRace",
        # Bulk row creation from caller-supplied text. One visitor importing
        # ten thousand racers ruins the demo for everyone else until the reset.
        "importRacers",
    }
)


class DemoPolicyExtension(SchemaExtension):
    """Refuse a mutation the public demo does not offer.

    Inert unless :func:`backend.demo_mode.enabled`, so an ordinary install pays
    one boolean per mutation and nothing else. Scoped to fields whose parent is
    ``Mutation``, like the two extensions either side of it — a query or a
    subscription costs one string compare.

    ``resolve`` and not ``on_execute``: raising from ``on_execute`` is silently
    swallowed and the mutation completes, which is a guard that passes its own
    test while permitting everything. The tests here assert the mutation was
    *refused* — that the row is absent — never that the check ran.

    ``PermissionDeniedError`` is reused rather than subclassed so that
    ``AuditExtension`` records the refusal without knowing this module exists.
    """

    def resolve(
        self, _next: Any, root: Any, info: Any, *args: Any, **kwargs: Any
    ) -> Any:
        if (
            info.parent_type.name == "Mutation"
            and info.field_name in REFUSED_MUTATIONS
            and demo_mode.enabled()
        ):
            raise PermissionDeniedError(
                f"{info.field_name} is not available on the demo"
            )
        return _next(root, info, *args, **kwargs)
