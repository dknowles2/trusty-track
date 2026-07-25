"""Pure domain logic: scheduling, scoring, and advancement.

Nothing in this package imports SQLAlchemy, Strawberry, or FastAPI. Everything
here takes plain values and returns plain values, which means it can be tested
exhaustively without a database fixture — the PPC scheduler is combinatorics,
and proving "every racer races in every lane exactly once" should not require
creating a race, a track, and four racers first.

The layering is:

    api/schema.py   resolvers, transport concerns
    db/crud.py      load rows, call domain, persist, publish
    domain/         rules, no I/O

Two deliberate compromises keep this from being purist:

* Strategy and advancement-source values are passed as plain strings. The
  corresponding model enums (``ScoringStrategy``, ``SchedulingStrategy``) are
  ``str`` enums whose values equal their names, so they pass through unchanged
  and there is no second copy of the vocabulary to keep in step.
* :mod:`backend.domain.lanes` knows the shape of the ``lane_results`` JSON blob.
  That is the one concession to persistence, and it is intentional: putting the
  codec in exactly one place is what will make issue #5 (normalising the blob
  into a ``heat_lanes`` table) a change to one module rather than a grep.
"""
