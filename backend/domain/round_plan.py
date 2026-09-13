"""Deriving a round wizard's answer back out of the rounds it built (#1088).

`api.schema.WizardConfigurationInput` (general round + championship rounds)
is exactly the shape the round wizard's own form fills in, and exactly the
shape `crud.create_rounds_from_plan` consumes to build rounds from. This
module runs that in reverse: given a race's existing rounds, what wizard
answer would have produced them? That is the "round plan" a copied race
carries forward (`Race.roundPlan`) — not the rounds themselves, which carry
heats and results nothing wants copied, but the *answer* that built them.

Pure, no SQLAlchemy and no Strawberry — see CLAUDE.md's "The domain layer
imports no SQLAlchemy and no Strawberry." `crud`/`api.schema` are the I/O
around this: they read a race's `Round` rows into `RoundFact`s and turn the
result back into ORM rows or a GraphQL type.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .advancement import ALL, EACH_GROUP, is_round_scoped, round_id_in


@dataclass(frozen=True)
class RoundFact:
    """The columns of one `models.Round` this module reads.

    A plain mirror rather than the ORM row itself — see the module
    docstring. Every field here is a column `models.Round` already has,
    except that `scheduling_strategy` crosses as its plain string value
    (CLAUDE.md's "Enum-ish values cross the boundary as plain strings").
    """

    id: int
    round_number: int
    name: str | None
    scheduling_strategy: str
    advancement_source: str | None
    advancement_num_racers: int | None
    advancement_from_bottom: bool
    elimination_losses: int | None
    balanced_phases: int | None
    #: Null for a round created before #1088's migration. Treated as `1`,
    #: the wizard's own default for "no opinion" — see `models.Round.
    #: runs_per_lane`.
    runs_per_lane: int | None


@dataclass(frozen=True)
class GeneralRoundPlan:
    """Mirrors `WizardGeneralRoundInput`."""

    type: str  # "ALL" or "EACH_GROUP"
    scheduling_strategy: str
    runs_per_lane: int
    elimination_losses: int | None
    balanced_phases: int | None


@dataclass(frozen=True)
class ChampionshipRoundPlan:
    """Mirrors `WizardChampionshipRoundInput`, plus `source_round_id`.

    `source_round_id` is not part of the wizard's own input shape — it is
    this championship round's own id in the race the plan was derived from,
    carried along so `crud.create_race` can remap a copied `ROUND:<id>`
    award to whichever new round takes this one's place (#1088's award
    remap). `create_rounds_from_plan` ignores it entirely when a plan
    reaches it through `createRoundWizard`, which has no old race to remap
    awards from.
    """

    name: str
    source: str  # "ALL", "EACH_GROUP", or "PREVIOUS"
    num_top_racers: int
    runs_per_lane: int
    advancement_from_bottom: bool
    source_round_id: int


@dataclass(frozen=True)
class RoundPlan:
    """Mirrors `WizardConfigurationInput` — see the module docstring."""

    general_round: GeneralRoundPlan
    championship_rounds: list[ChampionshipRoundPlan]


def plan_from_rounds(rounds: Sequence[RoundFact]) -> RoundPlan | None:
    """The wizard answer that would have built ``rounds``, or ``None``.

    ``None`` for a race with no rounds at all — there is no plan to offer,
    the same as a race whose wizard was never run. A race with championship
    rounds but no general round cannot arise through either door this
    module's callers write through, but is treated the same as "no plan"
    rather than raising, since a hand-built or corrupted race is not this
    function's problem to diagnose.

    **General round.** A race's general rounds are the ones with no
    ``advancement_source`` (CLAUDE.md's data model). Exactly one means
    ``type: "ALL"``; more than one means ``type: "EACH_GROUP"`` —
    `crud.create_general_round` is the only thing that ever builds more
    than one, one per racing group with a checked-in racer, and it is also
    the only thing `create_rounds_from_plan` calls to rebuild from the
    plan, so reproducing "EACH_GROUP" needs nothing about *which* groups:
    the new race's own current racing groups (whichever the copy carried
    over) are exactly what it iterates. `scheduling_strategy`,
    `elimination_losses` and `balanced_phases` are read off the first
    general round found — every general round of an "EACH_GROUP" split
    shares the same style, since the wizard offers no way to give them
    different ones.

    **Championship rounds**, in `round_number` order. A round's stored
    `advancement_source` is already the *resolved* value
    `resolve_championship_source` produced at creation time, not
    necessarily the wizard answer that led to it — an elimination general
    round rewrites a requested "ALL"/"EACH_GROUP" to point at itself, and
    the wizard's own "PREVIOUS" option resolves to a concrete
    `ROUND:<id>` the moment the round is created, never stored as the
    literal string "PREVIOUS". So:

    - `"ALL"`/`"EACH_GROUP"` stored literally is copied as-is — nothing
      rewrote it.
    - `"ROUND:<id>"` naming the *immediately preceding* championship round
      in this same list is recovered as `"PREVIOUS"` — unambiguous, since
      that chaining only ever happens from the wizard's own "PREVIOUS"
      option or `createRound`'s identical choice, both of which always
      chain to the round created immediately before.
    - `"ROUND:<id>"` naming anything else (typically the elimination
      general round) is recovered as `"ALL"` — `resolve_championship_source`
      collapses both `"ALL"` and `"EACH_GROUP"` to the identical
      `ROUND:<elimination round id>` when the general round is
      elimination, so which of the two was originally asked for cannot be
      recovered from the stored value alone; `"ALL"` is the more common
      answer and, applying `resolve_championship_source` again on the
      copy, reproduces the identical chained round either way.

    Reproducing the resolution step is `create_rounds_from_plan`'s job, not
    this function's — this only recovers the *requested* source, the same
    thing the wizard's own form would have been showing, so the copy goes
    through `resolve_championship_source` again exactly as fresh wizard
    input would (CLAUDE.md's #48: one rule, not a second copy of it here
    that could disagree).
    """
    general = [r for r in rounds if r.advancement_source is None]
    if not general:
        return None
    championship = sorted(
        (r for r in rounds if r.advancement_source is not None),
        key=lambda r: r.round_number,
    )

    first_general = min(general, key=lambda r: r.round_number)
    general_plan = GeneralRoundPlan(
        type="ALL" if len(general) == 1 else "EACH_GROUP",
        scheduling_strategy=first_general.scheduling_strategy,
        runs_per_lane=first_general.runs_per_lane or 1,
        elimination_losses=first_general.elimination_losses,
        balanced_phases=first_general.balanced_phases,
    )

    championship_plans: list[ChampionshipRoundPlan] = []
    previous_id: int | None = None
    for round_fact in championship:
        source = round_fact.advancement_source
        assert source is not None  # filtered above
        if source not in (ALL, EACH_GROUP):
            referenced_id = round_id_in(source) if is_round_scoped(source) else None
            source = "PREVIOUS" if referenced_id == previous_id else ALL
        championship_plans.append(
            ChampionshipRoundPlan(
                name=round_fact.name or "Championship Round",
                source=source,
                num_top_racers=round_fact.advancement_num_racers or 1,
                runs_per_lane=round_fact.runs_per_lane or 1,
                advancement_from_bottom=round_fact.advancement_from_bottom,
                source_round_id=round_fact.id,
            )
        )
        previous_id = round_fact.id

    return RoundPlan(general_round=general_plan, championship_rounds=championship_plans)
