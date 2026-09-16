"""The scheduling-algorithm registry (#1090, part B: "the seam"; PERFECT_N
added in part C).

`domain/scheduling.py`'s `generate_ppc` used to be the only way a `GENERAL`
round's schedule was built, chosen nowhere but `crud.generate_heats_for_round`
(~L2480). This module is the seam that stops being true: a `Round` now
carries a nullable `algorithm` column (`models.SchedulingAlgorithm`), and this
registry maps that column's string value to a `Scheduler` — everything a
caller needs to build one round's schedule, and to know up front whether this
algorithm can handle a field of this shape at all.

Enum-ish values cross the domain/API boundary as plain strings (CLAUDE.md's
"Enum-ish values cross the boundary as plain strings") — the registry is
keyed on `SchedulingAlgorithm`'s own string values rather than importing the
SQLAlchemy enum, so `domain/` still imports no SQLAlchemy and no Strawberry.

`generate_ppc` stays in `domain/scheduling.py`; nothing about it moved. This
module only wraps it — `SCHEDULERS["PPC"].generate` *is* `generate_ppc`,
called with the identical signature every registered algorithm shares.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from backend.domain.schedulers import perfect_n
from backend.domain.schedulers.rotation import generate_rotation
from backend.domain.scheduling import HeatPlan, generate_ppc

__all__ = ["Scheduler", "SCHEDULERS"]


class _Generate(Protocol):
    """The shape every registered algorithm's ``generate`` has.

    A `Protocol` rather than a bare `Callable[...]` alias so the parameter
    names show up at the call site; `generate_ppc` and `generate_rotation`
    satisfy it structurally, without either being written against this
    module.
    """

    def __call__(
        self,
        racer_ids: list[int],
        usable_lanes: Sequence[int],
        start_heat_number: int = 1,
        rng: random.Random | None = None,
    ) -> list[HeatPlan]: ...  # pragma: no cover - signature documentation only


@dataclass(frozen=True)
class Scheduler:
    """One algorithm a `GENERAL` round's schedule can be built from.

    ``generate`` has exactly `generate_ppc`'s signature, so
    `crud.generate_heats_for_round` (and `crud._reset_heats_in_place`, the
    other caller — see that function's own docstring for why it goes
    through this registry too) can call whichever one a round's `algorithm`
    names without knowing which it got.

    ``available_for`` is a reason this algorithm cannot schedule a field of
    this shape, or ``None`` if it can. Checked up front rather than
    discovered from a schedule that silently fails one of the shared
    properties `test_domain_scheduling.py` holds every registered algorithm
    to (`CLAUDE.md`'s domain-layer paragraph: "a new algorithm cannot be
    registered without passing every property the app relies on
    downstream").

    ``absorbs_latecomer`` says whether `crud.admit_late_racers` may append a
    newcomer to a round already part-way through using this algorithm (#172,
    #1090's decision 3). `PPC`'s per-newcomer appendix
    (`domain/latecomers.py`) works by giving the newcomer one heat per
    lane, filled with whoever else is available — it assumes nothing about
    who else is in that heat, which is exactly what a fixed rotation is not:
    every already-scheduled car's lane sequence is pinned to its own
    position in the field, and splicing a newcomer in without disturbing it
    has no answer short of rebuilding the round. An algorithm that cannot
    absorb one is not worse for it; it means admission has to regenerate
    the round outright (when nothing has been raced yet — always possible,
    whatever the algorithm) or refuse (once something has).
    """

    label: str
    generate: _Generate
    available_for: Callable[[int, int], str | None]
    absorbs_latecomer: bool


def _always_available(_n_racers: int, _n_lanes: int) -> str | None:
    return None


SCHEDULERS: dict[str, Scheduler] = {
    "PPC": Scheduler(
        label="Partial Perfect Chart",
        generate=generate_ppc,
        # Every field/lane shape `test_domain_scheduling.py` sweeps (racers
        # 2..20, lanes 2..8) already passes for PPC — issue #26 is precisely
        # the history of making that true unconditionally, including the
        # zero-lane and field-smaller-than-track edges. There is no (n,
        # lanes) PPC refuses.
        available_for=_always_available,
        absorbs_latecomer=True,
    ),
    "ROTATION": Scheduler(
        label="Lane rotation",
        generate=generate_rotation,
        # Rotation's circular-window design (see `schedulers/rotation.py`)
        # holds the same shared properties for every field and lane count,
        # including the edges PPC's own history warns about — there is
        # likewise no (n, lanes) it refuses.
        available_for=_always_available,
        absorbs_latecomer=False,
    ),
    "PERFECT_N": Scheduler(
        label="Perfect-N chart",
        generate=perfect_n.generate_perfect_n,
        # Unlike PPC and ROTATION, a real refusal — only the (lanes, n)
        # shapes `perfect_n_tables.TABLES` actually has a chart for. See
        # `schedulers/perfect_n.py`'s module docstring.
        available_for=perfect_n.available_for,
        # Adding one car to a perfect chart has no answer that keeps every
        # pair meeting the same number of times — #1090 decision 3. The
        # latecomer path regenerates the round when nothing has raced yet
        # (every algorithm supports that) or refuses once something has.
        absorbs_latecomer=False,
    ),
}
